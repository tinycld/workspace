package drive

import (
	"context"
	"errors"
	"mime"
	"os"
	"path"
	"time"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"golang.org/x/net/webdav"
)

const pbTimeFormat = "2006-01-02 15:04:05.000Z"

type contextKey string

// userKey is the context key under which the WebDAV middleware in
// register.go stashes the authenticated *core.Record. FileSystem methods
// look it up via userFromContext — they never re-authenticate.
const userKey contextKey = "drive.webdav.user"

// DriveFileSystem implements webdav.FileSystem (golang.org/x/net/webdav)
// backed by PocketBase drive_items records. The set of paths it serves
// is rooted at "/drive/" and structured as
// "/drive/<orgSlug>/<segments...>"; the root and each org root are
// synthetic directories.
type DriveFileSystem struct {
	app *pocketbase.PocketBase
}

var _ webdav.FileSystem = (*DriveFileSystem)(nil)

// userFromContext returns the user the WebDAV auth middleware attached
// to the request context. Anything reaching a FileSystem method without
// a user is a programming error — the middleware always enforces auth
// before dispatching to the handler.
func (fs *DriveFileSystem) userFromContext(ctx context.Context) (*core.Record, error) {
	user, ok := ctx.Value(userKey).(*core.Record)
	if !ok || user == nil {
		return nil, errors.New("drive webdav: missing authenticated user in context")
	}
	return user, nil
}

// resolveContext authenticates and resolves the org from the path.
// Returns os.ErrNotExist when the path is the WebDAV root (no org slug);
// callers above this layer (Stat, OpenFile read on root, etc.) handle
// the root case before invoking this helper.
func (fs *DriveFileSystem) resolveContext(ctx context.Context, name string) (user *core.Record, org *core.Record, userOrg *core.Record, orgSlug string, segments []string, err error) {
	user, err = fs.userFromContext(ctx)
	if err != nil {
		return
	}

	orgSlug, segments = parsePath(name)
	if orgSlug == "" {
		err = os.ErrNotExist
		return
	}

	org, err = resolveOrg(fs.app, orgSlug)
	if err != nil {
		return
	}

	userOrg, err = getUserOrgForOrg(fs.app, user.Id, org.Id)
	return
}

func isRootPath(name string) bool {
	orgSlug, _ := parsePath(name)
	return orgSlug == ""
}

// Stat resolves the path to either the synthetic root, an org-root, or
// a backing drive_items record.
func (fs *DriveFileSystem) Stat(ctx context.Context, name string) (os.FileInfo, error) {
	if isRootPath(name) {
		if _, err := fs.userFromContext(ctx); err != nil {
			return nil, err
		}
		return &driveFileInfo{name: "drive", isDir: true}, nil
	}

	_, org, _, orgSlug, segments, err := fs.resolveContext(ctx, name)
	if err != nil {
		return nil, err
	}

	if len(segments) == 0 {
		return &driveFileInfo{name: orgSlug, isDir: true}, nil
	}

	record, err := resolveItemByPath(fs.app, org.Id, segments)
	if err != nil {
		return nil, err
	}

	return recordToFileInfo(record), nil
}

// OpenFile dispatches to the read or write path based on flag bits.
// Directories always return a directory driveFile (read-only and never
// has its Read called by the handler); files return either a seekable
// reader-backed driveFile (read) or a temp-file-backed driveFile (write).
func (fs *DriveFileSystem) OpenFile(ctx context.Context, name string, flag int, perm os.FileMode) (webdav.File, error) {
	wantWrite := flag&(os.O_WRONLY|os.O_RDWR) != 0

	if wantWrite {
		return fs.openForWrite(ctx, name, flag)
	}
	return fs.openForRead(ctx, name)
}

// openForRead handles GET, HEAD and the read side of COPY. A successful
// open of a file returns a driveFile with rdSeeker primed; a successful
// open of any directory (root, org root, or folder) returns a driveFile
// with children pre-populated for Readdir.
func (fs *DriveFileSystem) openForRead(ctx context.Context, name string) (webdav.File, error) {
	if isRootPath(name) {
		user, err := fs.userFromContext(ctx)
		if err != nil {
			return nil, err
		}
		children, err := fs.listUserOrgs(user.Id)
		if err != nil {
			return nil, err
		}
		return &driveFile{
			info:     &driveFileInfo{name: "drive", isDir: true},
			children: children,
		}, nil
	}

	_, org, _, orgSlug, segments, err := fs.resolveContext(ctx, name)
	if err != nil {
		return nil, err
	}

	if len(segments) == 0 {
		children, err := fs.listOrgChildren(org.Id, "")
		if err != nil {
			return nil, err
		}
		return &driveFile{
			info:     &driveFileInfo{name: orgSlug, isDir: true},
			children: children,
		}, nil
	}

	record, err := resolveItemByPath(fs.app, org.Id, segments)
	if err != nil {
		return nil, err
	}

	if record.GetBool("is_folder") {
		children, err := fs.listOrgChildren(org.Id, record.Id)
		if err != nil {
			return nil, err
		}
		return &driveFile{
			info:     recordToFileInfo(record),
			children: children,
		}, nil
	}

	rdr, tmpPath, err := openSeekableContent(fs.app, record)
	if err != nil {
		return nil, err
	}
	return &driveFile{
		info:     recordToFileInfo(record),
		rdSeeker: rdr,
		tmpPath:  tmpPath,
	}, nil
}

// openForWrite handles PUT and the write side of COPY. The temp file is
// created eagerly so the handler's io.Copy works as soon as it returns;
// the actual persistence into a drive_items record happens on Close.
// Quota and write-permission checks are deferred to Close because that
// is when the final size is known.
func (fs *DriveFileSystem) openForWrite(ctx context.Context, name string, flag int) (webdav.File, error) {
	_, org, userOrg, _, segments, err := fs.resolveContext(ctx, name)
	if err != nil {
		return nil, err
	}

	if len(segments) == 0 {
		return nil, os.ErrPermission
	}

	parentID, itemName, err := resolveParentByPath(fs.app, org.Id, segments)
	if err != nil {
		return nil, err
	}

	existing, _ := resolveItemByPath(fs.app, org.Id, segments)
	if existing != nil && existing.GetBool("is_folder") {
		return nil, os.ErrPermission
	}

	if existing == nil && flag&os.O_CREATE == 0 {
		return nil, os.ErrNotExist
	}

	tmp, err := os.CreateTemp("", "tinycld-drive-*")
	if err != nil {
		return nil, err
	}

	return &driveFile{
		fs:       fs,
		info:     &driveFileInfo{name: itemName},
		wrBuf:    tmp,
		wrName:   itemName,
		parentID: parentID,
		orgID:    org.Id,
		userOrg:  userOrg,
		existing: existing,
	}, nil
}

// Mkdir creates a folder drive_items record at the given path. Parent
// must exist. The handler treats os.ErrExist as 405.
func (fs *DriveFileSystem) Mkdir(ctx context.Context, name string, _ os.FileMode) error {
	_, org, userOrg, _, segments, err := fs.resolveContext(ctx, name)
	if err != nil {
		return err
	}

	if len(segments) == 0 {
		return os.ErrPermission
	}

	parentID, folderName, err := resolveParentByPath(fs.app, org.Id, segments)
	if err != nil {
		return err
	}

	if existing, _ := resolveItemByPath(fs.app, org.Id, segments); existing != nil {
		return os.ErrExist
	}

	collection, err := fs.app.FindCollectionByNameOrId("drive_items")
	if err != nil {
		return err
	}

	record := core.NewRecord(collection)
	record.Set("org", org.Id)
	record.Set("name", folderName)
	record.Set("is_folder", true)
	record.Set("parent", parentID)
	record.Set("created_by", userOrg.Id)

	// The OnRecordCreate("drive_items") hook in register.go creates the
	// owner drive_shares row in the same transaction; no follow-up call needed.
	if err := fs.app.Save(record); err != nil {
		return err
	}

	return nil
}

// RemoveAll deletes the drive_items record at the given path. PocketBase
// cascade rules handle recursive deletion of folder children.
func (fs *DriveFileSystem) RemoveAll(ctx context.Context, name string) error {
	_, org, userOrg, _, segments, err := fs.resolveContext(ctx, name)
	if err != nil {
		return err
	}

	if len(segments) == 0 {
		return os.ErrPermission
	}

	record, err := resolveItemByPath(fs.app, org.Id, segments)
	if err != nil {
		return err
	}

	if err := checkDeletePermission(fs.app, userOrg.Id, record.Id); err != nil {
		return err
	}

	return fs.app.Delete(record)
}

// Rename implements MOVE. The handler pre-removes an existing
// destination only when Overwrite: T is set; otherwise we must report
// os.ErrExist if the destination is still present.
func (fs *DriveFileSystem) Rename(ctx context.Context, oldName, newName string) error {
	_, srcOrg, userOrg, _, srcSegments, err := fs.resolveContext(ctx, oldName)
	if err != nil {
		return err
	}

	_, destOrg, _, _, destSegments, err := fs.resolveContext(ctx, newName)
	if err != nil {
		return err
	}

	if srcOrg.Id != destOrg.Id {
		return os.ErrPermission
	}

	if len(srcSegments) == 0 || len(destSegments) == 0 {
		return os.ErrPermission
	}

	srcRecord, err := resolveItemByPath(fs.app, srcOrg.Id, srcSegments)
	if err != nil {
		return err
	}

	if err := checkWritePermission(fs.app, userOrg.Id, srcRecord.Id); err != nil {
		return err
	}

	if existing, _ := resolveItemByPath(fs.app, destOrg.Id, destSegments); existing != nil {
		return os.ErrExist
	}

	destParentID, destName, err := resolveParentByPath(fs.app, destOrg.Id, destSegments)
	if err != nil {
		return err
	}

	srcRecord.Set("name", destName)
	srcRecord.Set("parent", destParentID)

	return fs.app.Save(srcRecord)
}

// listUserOrgs returns one synthetic directory entry per org the user
// belongs to, for Readdir on the WebDAV root. Folder names use org.slug.
func (fs *DriveFileSystem) listUserOrgs(userID string) ([]os.FileInfo, error) {
	userOrgs, err := fs.app.FindRecordsByFilter(
		"user_org",
		"user = {:user}",
		"",
		100,
		0,
		map[string]any{"user": userID},
	)
	if err != nil {
		return nil, err
	}

	infos := make([]os.FileInfo, 0, len(userOrgs))
	for _, uo := range userOrgs {
		orgID := uo.GetString("org")
		if orgID == "" {
			continue
		}
		o, err := fs.app.FindRecordById("orgs", orgID)
		if err != nil {
			continue
		}
		slug := o.GetString("slug")
		if slug == "" {
			continue
		}
		infos = append(infos, &driveFileInfo{name: slug, isDir: true})
	}

	return infos, nil
}

// listOrgChildren returns the immediate child drive_items of a given
// parent (or, for empty parentID, of the org root).
func (fs *DriveFileSystem) listOrgChildren(orgID, parentID string) ([]os.FileInfo, error) {
	filter := "org = {:org}"
	params := map[string]any{"org": orgID}
	if parentID == "" {
		filter += " && parent = ''"
	} else {
		filter += " && parent = {:parent}"
		params["parent"] = parentID
	}

	records, err := fs.app.FindRecordsByFilter("drive_items", filter, "name", 0, 0, params)
	if err != nil {
		return nil, err
	}

	infos := make([]os.FileInfo, 0, len(records))
	for _, r := range records {
		infos = append(infos, recordToFileInfo(r))
	}
	return infos, nil
}

// recordToFileInfo builds an os.FileInfo from a drive_items record.
func recordToFileInfo(record *core.Record) *driveFileInfo {
	modTime := time.Time{}
	if updated := record.GetString("updated"); updated != "" {
		if t, err := time.Parse(pbTimeFormat, updated); err == nil {
			modTime = t
		}
	}
	return &driveFileInfo{
		name:    record.GetString("name"),
		size:    int64(record.GetInt("size")),
		modTime: modTime,
		isDir:   record.GetBool("is_folder"),
		record:  record,
	}
}

// guessMimeType derives a Content-Type from a basename's extension,
// falling back to application/octet-stream. Used when we don't have a
// source MIME type to carry over (which is always under x/net/webdav,
// since the framework reads bytes only — no Content-Type ever reaches
// us).
func guessMimeType(filename string) string {
	if t := mime.TypeByExtension(path.Ext(filename)); t != "" {
		return t
	}
	return "application/octet-stream"
}
