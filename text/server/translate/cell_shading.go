package translate

import (
	"encoding/xml"
	"strings"

	"github.com/ZeroHawkeye/wordZero/pkg/document"
)

// parseTcShading reads <w:shd> off the current decoder cursor and
// returns a CSS hex color ("#RRGGBB") or empty string when shading is
// absent / unrepresentable. v1 ignores the foreground color
// (w:color), pattern (w:val != "clear"), and theme fill (w:themeFill);
// only the cell background fill round-trips.
//
// `w:fill="auto"` means "no explicit fill, fall through to theme/style
// default" — we return empty so the PM attr stays nil and the cell
// renders with the document's default background.
func parseTcShading(start xml.StartElement) string {
	fill := attrValue(start, "fill")
	if fill == "" || strings.EqualFold(fill, "auto") {
		return ""
	}
	return normalizeShadingHex(fill)
}

// normalizeShadingHex coerces whatever the .docx (or external caller)
// gave us into the canonical "#RRGGBB" uppercase form we store on the
// PM node. Returns empty string for anything that isn't six hex digits.
func normalizeShadingHex(raw string) string {
	value := raw
	if strings.HasPrefix(value, "#") {
		value = value[1:]
	}
	if len(value) != 6 {
		return ""
	}
	for i := 0; i < len(value); i++ {
		c := value[i]
		isHex := (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
		if !isHex {
			return ""
		}
	}
	return "#" + strings.ToUpper(value)
}

// tcShadingFromAttr builds a WordZero TableCellShading from the
// `shading` PM attr. Returns nil when the attr is missing, the wrong
// shape, or not a valid hex. The emitter attaches the result to
// TableCellProperties.Shd if non-nil.
//
// Word's <w:shd w:fill> takes the hex without a leading '#'; we strip
// it here. We always emit w:val="clear" + w:color="auto" — v1 doesn't
// support patterned shading or non-auto foregrounds.
func tcShadingFromAttr(attrs map[string]any) *document.TableCellShading {
	raw, ok := attrs["shading"].(string)
	if !ok || raw == "" {
		return nil
	}
	normalized := normalizeShadingHex(raw)
	if normalized == "" {
		return nil
	}
	return &document.TableCellShading{
		Val:   "clear",
		Color: "auto",
		Fill:  strings.TrimPrefix(normalized, "#"),
	}
}
