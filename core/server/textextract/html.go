package textextract

import (
	"io"
	"regexp"
	"strings"

	"github.com/microcosm-cc/bluemonday"
)

var collapseWS = regexp.MustCompile(`\s+`)

type htmlExtractor struct{}

func init() {
	Register("text/html", &htmlExtractor{})
}

func (e *htmlExtractor) Extract(r io.Reader, limit int) (string, error) {
	data, err := io.ReadAll(io.LimitReader(r, int64(limit)*4))
	if err != nil {
		return "", nil
	}

	text := bluemonday.StrictPolicy().Sanitize(string(data))
	text = strings.ReplaceAll(text, "&nbsp;", " ")
	text = strings.ReplaceAll(text, "&#160;", " ")
	text = strings.ReplaceAll(text, "&amp;", "&")
	text = strings.ReplaceAll(text, "&lt;", "<")
	text = strings.ReplaceAll(text, "&gt;", ">")
	text = strings.ReplaceAll(text, "&#34;", `"`)
	text = strings.ReplaceAll(text, "&#39;", "'")
	text = collapseWS.ReplaceAllString(text, " ")
	text = strings.TrimSpace(text)

	if len(text) > limit {
		text = text[:limit]
	}
	return text, nil
}
