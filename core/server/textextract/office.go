package textextract

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"io"
	"sort"
	"strings"
)

func init() {
	Register("application/vnd.openxmlformats-officedocument.wordprocessingml.document", &docxExtractor{})
	Register("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", &xlsxExtractor{})
	Register("application/vnd.openxmlformats-officedocument.presentationml.presentation", &pptxExtractor{})
}

// openZip buffers the reader and opens as a zip archive.
func openZip(r io.Reader, limit int64) (*zip.Reader, error) {
	data, err := io.ReadAll(io.LimitReader(r, limit))
	if err != nil {
		return nil, err
	}
	return zip.NewReader(bytes.NewReader(data), int64(len(data)))
}

// extractXMLText reads an XML file from the zip and extracts all text content
// from elements matching the given local name.
func extractXMLText(zr *zip.Reader, filename string, localNames []string, limit int) string {
	f, err := findZipFile(zr, filename)
	if err != nil {
		return ""
	}
	rc, err := f.Open()
	if err != nil {
		return ""
	}
	defer rc.Close()

	nameSet := make(map[string]bool, len(localNames))
	for _, n := range localNames {
		nameSet[n] = true
	}

	var sb strings.Builder
	decoder := xml.NewDecoder(rc)
	for {
		tok, err := decoder.Token()
		if err != nil {
			break
		}
		if se, ok := tok.(xml.StartElement); ok && nameSet[se.Name.Local] {
			var text string
			if err := decoder.DecodeElement(&text, &se); err == nil && text != "" {
				if sb.Len() > 0 {
					sb.WriteByte(' ')
				}
				sb.WriteString(text)
				if sb.Len() > limit {
					break
				}
			}
		}
	}

	result := sb.String()
	if len(result) > limit {
		result = result[:limit]
	}
	return result
}

func findZipFile(zr *zip.Reader, name string) (*zip.File, error) {
	for _, f := range zr.File {
		if f.Name == name {
			return f, nil
		}
	}
	return nil, io.EOF
}

// --- DOCX ---

type docxExtractor struct{}

func (e *docxExtractor) Extract(r io.Reader, limit int) (string, error) {
	zr, err := openZip(r, maxPDFInputBytes)
	if err != nil {
		return "", nil
	}
	text := extractXMLText(zr, "word/document.xml", []string{"t"}, limit)
	return strings.TrimSpace(text), nil
}

// --- XLSX ---

type xlsxExtractor struct{}

func (e *xlsxExtractor) Extract(r io.Reader, limit int) (string, error) {
	zr, err := openZip(r, maxPDFInputBytes)
	if err != nil {
		return "", nil
	}
	text := extractXMLText(zr, "xl/sharedStrings.xml", []string{"t"}, limit)
	return strings.TrimSpace(text), nil
}

// --- PPTX ---

type pptxExtractor struct{}

func (e *pptxExtractor) Extract(r io.Reader, limit int) (string, error) {
	zr, err := openZip(r, maxPDFInputBytes)
	if err != nil {
		return "", nil
	}

	// Find all slide files and sort them
	var slideFiles []string
	for _, f := range zr.File {
		if strings.HasPrefix(f.Name, "ppt/slides/slide") && strings.HasSuffix(f.Name, ".xml") {
			slideFiles = append(slideFiles, f.Name)
		}
	}
	sort.Strings(slideFiles)

	var sb strings.Builder
	for _, name := range slideFiles {
		text := extractXMLText(zr, name, []string{"t"}, limit-sb.Len())
		if text != "" {
			if sb.Len() > 0 {
				sb.WriteByte(' ')
			}
			sb.WriteString(text)
			if sb.Len() > limit {
				break
			}
		}
	}

	result := sb.String()
	if len(result) > limit {
		result = result[:limit]
	}
	return strings.TrimSpace(result), nil
}
