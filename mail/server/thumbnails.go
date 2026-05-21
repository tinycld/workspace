package mail

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"

	"tinycld.org/core/thumbnails"
)

// attachmentsChanged reports whether the `attachments` field differs from its
// pre-update snapshot. The thumbnail hook uses it to skip work when an unrelated
// field changed (including the thumbnail fields the hook itself writes).
func attachmentsChanged(record *core.Record) bool {
	current := record.GetStringSlice("attachments")
	previous := record.Original().GetStringSlice("attachments")
	if len(current) != len(previous) {
		return true
	}
	for i := range current {
		if current[i] != previous[i] {
			return true
		}
	}
	return false
}

// thumbInFlight prevents two goroutines from racing on the same record. The hook
// fires on every create and update, including the update we ourselves trigger to
// store the generated thumbnails — without this guard, two parallel runs against
// the same record could see the same "no thumbs yet" snapshot and double-write.
var thumbInFlight sync.Map

// generateAttachmentThumbnails walks every attachment on a mail_messages record
// and produces a JPEG thumbnail for each one whose MIME type the core thumbnail
// pipeline supports. Generated thumbnails are stored on the message's
// attachment_thumbnails file field; the attachment_thumbnail_map JSON field
// records the original→thumbnail filename mapping so clients can look up the
// thumb by attachment name. Designed to run in a background goroutine.
func generateAttachmentThumbnails(app *pocketbase.PocketBase, record *core.Record) {
	defer func() {
		if r := recover(); r != nil {
			app.Logger().Error("Mail thumbnail: panic recovered",
				"id", record.Id, "panic", fmt.Sprintf("%v", r))
		}
	}()

	attachments := record.GetStringSlice("attachments")
	if len(attachments) == 0 {
		return
	}

	// Acquire the per-record in-flight lock; bail if another goroutine is already
	// processing this record.
	if _, busy := thumbInFlight.LoadOrStore(record.Id, struct{}{}); busy {
		return
	}
	defer thumbInFlight.Delete(record.Id)

	// Don't regenerate for attachments that already have a thumbnail mapping.
	existingMap := readThumbnailMap(record)
	hasNewWork := false
	for _, fname := range attachments {
		if _, ok := existingMap[fname]; !ok {
			if mime := mimeForAttachment(fname); thumbnails.CanGenerate(mime) {
				hasNewWork = true
				break
			}
		}
	}
	if !hasNewWork {
		return
	}

	fsys, err := app.NewFilesystem()
	if err != nil {
		app.Logger().Warn("Mail thumbnail: filesystem open failed", "id", record.Id, "error", err)
		return
	}
	defer fsys.Close()

	// Re-fetch the record fresh; we'll mutate it.
	fresh, err := app.FindRecordById("mail_messages", record.Id)
	if err != nil {
		app.Logger().Warn("Mail thumbnail: record refetch failed", "id", record.Id, "error", err)
		return
	}

	thumbMap := readThumbnailMap(fresh)
	existingThumbs := fresh.GetStringSlice("attachment_thumbnails")
	produced := []*filesystem.File{}

	for _, fname := range attachments {
		if _, ok := thumbMap[fname]; ok {
			continue
		}
		mime := mimeForAttachment(fname)
		if !thumbnails.CanGenerate(mime) {
			continue
		}
		thumbFile, thumbName, err := renderThumbnail(app, fsys, record.BaseFilesPath(), fname, mime)
		if err != nil {
			app.Logger().Warn("Mail thumbnail: generation failed",
				"id", record.Id, "attachment", fname, "error", err)
			continue
		}
		thumbMap[fname] = thumbName
		produced = append(produced, thumbFile)
	}

	if len(produced) == 0 {
		return
	}

	// Append produced thumbnail files to existing slice.
	mergedThumbnails := make([]any, 0, len(existingThumbs)+len(produced))
	for _, name := range existingThumbs {
		mergedThumbnails = append(mergedThumbnails, name)
	}
	for _, file := range produced {
		mergedThumbnails = append(mergedThumbnails, file)
	}

	thumbMapBytes, err := json.Marshal(thumbMap)
	if err != nil {
		app.Logger().Warn("Mail thumbnail: thumb map marshal failed", "id", record.Id, "error", err)
		return
	}

	fresh.Set("attachment_thumbnails", mergedThumbnails)
	fresh.Set("attachment_thumbnail_map", string(thumbMapBytes))

	if err := app.Save(fresh); err != nil {
		app.Logger().Warn("Mail thumbnail: save failed", "id", record.Id, "error", err)
		return
	}
	app.Logger().Info("Mail thumbnail: saved",
		"id", record.Id, "added", len(produced), "total", len(thumbMap))
}

func renderThumbnail(
	app *pocketbase.PocketBase,
	fsys *filesystem.System,
	basePath string,
	originalName string,
	mimeType string,
) (*filesystem.File, string, error) {
	key := basePath + "/" + originalName
	blob, err := fsys.GetReader(key)
	if err != nil {
		return nil, "", err
	}
	defer blob.Close()

	tmpDir := os.TempDir()
	ext := filepath.Ext(originalName)
	if ext == "" {
		ext = extensionForMime(mimeType)
	}

	inputFile, err := os.CreateTemp(tmpDir, "mailthumb-in-*"+ext)
	if err != nil {
		return nil, "", err
	}
	inputPath := inputFile.Name()
	defer os.Remove(inputPath)
	if _, err := inputFile.ReadFrom(blob); err != nil {
		inputFile.Close()
		return nil, "", err
	}
	inputFile.Close()

	outputFile, err := os.CreateTemp(tmpDir, "mailthumb-out-*.jpg")
	if err != nil {
		return nil, "", err
	}
	outputPath := outputFile.Name()
	outputFile.Close()
	defer os.Remove(outputPath)

	if err := thumbnails.Generate(inputPath, outputPath, mimeType, thumbnails.DefaultWidth, thumbnails.DefaultHeight); err != nil {
		return nil, "", err
	}

	thumbData, err := os.ReadFile(outputPath)
	if err != nil {
		return nil, "", err
	}

	thumbName := strings.TrimSuffix(originalName, filepath.Ext(originalName)) + "_thumb.jpg"
	f, err := filesystem.NewFileFromBytes(thumbData, thumbName)
	if err != nil {
		return nil, "", err
	}
	return f, f.Name, nil
}

func readThumbnailMap(record *core.Record) map[string]string {
	raw := record.GetString("attachment_thumbnail_map")
	if raw == "" {
		return map[string]string{}
	}
	out := map[string]string{}
	_ = json.Unmarshal([]byte(raw), &out)
	if out == nil {
		return map[string]string{}
	}
	return out
}

// mimeForAttachment infers a MIME type from an attachment's filename. PocketBase
// adds a 10-char random suffix to file names; we match against the trailing
// extension so a name like "doc_abc1234567.pdf" still maps to "application/pdf".
func mimeForAttachment(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".pdf":
		return "application/pdf"
	case ".epub":
		return "application/epub+zip"
	case ".docx":
		return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	case ".xlsx":
		return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	case ".pptx":
		return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
	case ".doc":
		return "application/msword"
	case ".xls":
		return "application/vnd.ms-excel"
	case ".ppt":
		return "application/vnd.ms-powerpoint"
	case ".heic", ".heif":
		return "image/heic"
	}
	return ""
}

func extensionForMime(mimeType string) string {
	switch mimeType {
	case "application/pdf":
		return ".pdf"
	case "application/epub+zip":
		return ".epub"
	case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
		return ".docx"
	case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
		return ".xlsx"
	case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
		return ".pptx"
	case "image/heic", "image/heic-sequence":
		return ".heic"
	case "image/heif", "image/heif-sequence":
		return ".heif"
	default:
		return ".bin"
	}
}
