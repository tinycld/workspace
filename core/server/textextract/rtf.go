package textextract

import (
	"io"
	"strings"
)

type rtfExtractor struct{}

func init() {
	Register("application/rtf", &rtfExtractor{})
	Register("text/rtf", &rtfExtractor{})
}

// Extract strips RTF control words and group delimiters to produce plain text.
func (e *rtfExtractor) Extract(r io.Reader, limit int) (string, error) {
	data, err := io.ReadAll(io.LimitReader(r, int64(limit)*4))
	if err != nil {
		return "", nil
	}

	var sb strings.Builder
	src := string(data)
	i := 0
	depth := 0

	for i < len(src) {
		ch := src[i]
		switch {
		case ch == '{':
			depth++
			i++
		case ch == '}':
			if depth > 0 {
				depth--
			}
			i++
		case ch == '\\':
			i++
			if i >= len(src) {
				break
			}
			next := src[i]
			// Escaped literal characters
			if next == '{' || next == '}' || next == '\\' {
				sb.WriteByte(next)
				i++
				continue
			}
			// \par and \line → newline
			if strings.HasPrefix(src[i:], "par") || strings.HasPrefix(src[i:], "line") {
				sb.WriteByte(' ')
			}
			// Skip control word (letters) and optional numeric argument
			for i < len(src) && src[i] >= 'a' && src[i] <= 'z' {
				i++
			}
			// Skip optional negative sign and digits
			if i < len(src) && src[i] == '-' {
				i++
			}
			for i < len(src) && src[i] >= '0' && src[i] <= '9' {
				i++
			}
			// Skip the delimiter space (if present)
			if i < len(src) && src[i] == ' ' {
				i++
			}
		default:
			if ch == '\n' || ch == '\r' {
				i++
				continue
			}
			sb.WriteByte(ch)
			i++
		}

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
