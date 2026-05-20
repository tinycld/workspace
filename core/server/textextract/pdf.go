package textextract

import (
	"bytes"
	"io"
	"strings"

	"github.com/ledongthuc/pdf"
)

const maxPDFInputBytes = 10 * 1024 * 1024 // 10MB cap on input

type pdfExtractor struct{}

func init() {
	Register("application/pdf", &pdfExtractor{})
}

func (e *pdfExtractor) Extract(r io.Reader, limit int) (string, error) {
	// The PDF library needs io.ReaderAt, so buffer the input
	data, err := io.ReadAll(io.LimitReader(r, maxPDFInputBytes+1))
	if err != nil {
		return "", nil
	}
	if len(data) > maxPDFInputBytes {
		data = data[:maxPDFInputBytes]
	}
	if len(data) == 0 {
		return "", nil
	}

	reader := bytes.NewReader(data)
	pdfReader, err := pdf.NewReader(reader, int64(len(data)))
	if err != nil {
		return "", nil
	}

	var sb strings.Builder
	numPages := pdfReader.NumPage()
	for i := 1; i <= numPages; i++ {
		page := pdfReader.Page(i)
		if page.V.IsNull() {
			continue
		}
		text, err := page.GetPlainText(nil)
		if err != nil {
			continue
		}
		sb.WriteString(text)
		sb.WriteByte(' ')
		if sb.Len() > limit {
			break
		}
	}

	result := strings.TrimSpace(sb.String())
	if len(result) > limit {
		result = result[:limit]
	}
	return result, nil
}
