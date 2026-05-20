package textextract

import (
	"io"
	"strings"
)

type textExtractor struct{}

func init() {
	Register("text/plain", &textExtractor{})
}

func (e *textExtractor) Extract(r io.Reader, limit int) (string, error) {
	data, err := io.ReadAll(io.LimitReader(r, int64(limit)+1))
	if err != nil {
		return "", nil
	}
	if len(data) > limit {
		data = data[:limit]
	}
	return strings.TrimSpace(string(data)), nil
}
