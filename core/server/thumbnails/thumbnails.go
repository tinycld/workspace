package thumbnails

import (
	"fmt"
	"image"
	"image/jpeg"
	"os"
	"slices"
	"strings"
	"sync"

	"github.com/disintegration/imaging"
	"github.com/gen2brain/go-fitz"
	"github.com/jdeng/goheif"
)

// DefaultWidth is the default thumbnail width.
const DefaultWidth = 480

// DefaultHeight is the default thumbnail height.
const DefaultHeight = 360

// fitzMu serializes all go-fitz (mupdf CGo) operations.
// MuPDF is not thread-safe, so concurrent calls cause SIGSEGV.
var fitzMu sync.Mutex

// fitzMimeTypes lists MIME types that go-fitz (mupdf) can render.
var fitzMimeTypes = []string{
	"application/pdf",
	"application/epub+zip",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation",
	"application/vnd.ms-word",
	"application/vnd.ms-excel",
	"application/vnd.ms-powerpoint",
	"application/msword",
}

// heifMimeTypes lists MIME types we decode via goheif. iPhone photo library
// emits image/heic for HEVC-encoded stills; image/heif covers the container.
var heifMimeTypes = []string{
	"image/heic",
	"image/heif",
	"image/heic-sequence",
	"image/heif-sequence",
}

// CanGenerate reports whether a thumbnail can be generated for the given MIME type.
// Images are handled by PocketBase's built-in ?thumb= parameter, except HEIC/HEIF
// which Go's stdlib can't decode — we render those ourselves.
func CanGenerate(mimeType string) bool {
	mt := normalizeMime(mimeType)
	return slices.Contains(fitzMimeTypes, mt) || slices.Contains(heifMimeTypes, mt)
}

// Generate renders inputPath as a JPEG thumbnail at outputPath, resized to fit
// within width x height while preserving aspect ratio. The decoder is chosen
// from the file's MIME type.
func Generate(inputPath, outputPath, mimeType string, width, height int) error {
	if slices.Contains(heifMimeTypes, normalizeMime(mimeType)) {
		return generateFromHeif(inputPath, outputPath, width, height)
	}
	return generateFromFitz(inputPath, outputPath, width, height)
}

func generateFromFitz(inputPath, outputPath string, width, height int) error {
	fitzMu.Lock()
	defer fitzMu.Unlock()

	doc, err := fitz.New(inputPath)
	if err != nil {
		return fmt.Errorf("thumbnails: failed to open document: %w", err)
	}
	defer doc.Close()

	img, err := doc.Image(0)
	if err != nil {
		return fmt.Errorf("thumbnails: failed to render page: %w", err)
	}

	return writeJpegThumb(img, outputPath, width, height)
}

func generateFromHeif(inputPath, outputPath string, width, height int) error {
	in, err := os.Open(inputPath)
	if err != nil {
		return fmt.Errorf("thumbnails: failed to open heif: %w", err)
	}
	defer in.Close()

	img, err := goheif.Decode(in)
	if err != nil {
		return fmt.Errorf("thumbnails: failed to decode heif: %w", err)
	}

	return writeJpegThumb(img, outputPath, width, height)
}

func writeJpegThumb(img image.Image, outputPath string, width, height int) error {
	thumb := imaging.Fit(img, width, height, imaging.Lanczos)

	out, err := os.Create(outputPath)
	if err != nil {
		return fmt.Errorf("thumbnails: failed to create output file: %w", err)
	}
	defer out.Close()

	if err := jpeg.Encode(out, thumb, &jpeg.Options{Quality: 85}); err != nil {
		return fmt.Errorf("thumbnails: failed to encode JPEG: %w", err)
	}

	return nil
}

func normalizeMime(mimeType string) string {
	return strings.ToLower(strings.TrimSpace(mimeType))
}
