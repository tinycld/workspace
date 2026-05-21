package render

import (
	"strings"
)

// writeCell emits one <td class="tinycld-calc-cell …" style="…">…</td>.
// Cell style is rendered as a mix of:
//
//   - Boolean classes (bold/italic/underline/strike/align/valign/wrap,
//     border-{edge}). These map to fixed CSS rules in
//     preview-css.ts / print-css.web.ts.
//   - Inline `style=` for the open-set values that don't fit a fixed
//     class vocabulary: color, background, font-size, font-family.
//     Emitted directly because typed `attr()` is not yet broadly
//     supported and the sanitizer permits a narrow safe-property
//     allowlist (see sanitize.go::safeStyleProperties).
//
// Each style value is validated at emit time before being interpolated
// into the attribute (isSafeColorAttr, isSafeFontFamily), so the
// sanitizer's pass is defense-in-depth rather than load-bearing.
//
// Display text is HTML-escaped. We never trust the imported string:
// excelize.GetCellValue returns whatever the cell stored, including
// `<script>` if some hostile workbook author tried to inject it. The
// sanitizer pass would catch <script> via tag allowlist, but escaping
// at emit time is the right defense-in-depth.
func writeCell(b *strings.Builder, cell Cell) {
	writeCellWithMerge(b, cell, "")
}

// writeCellWithMerge is the merge-aware variant. mergeAttrs is a
// pre-rendered string like ` colspan="2" rowspan="3"` (leading space
// included) that's interpolated unchanged into the <td> open tag.
// Empty string means "no merge anchor — just a normal cell".
func writeCellWithMerge(b *strings.Builder, cell Cell, mergeAttrs string) {
	classes := []string{"tinycld-calc-cell"}
	classes = appendStyleClasses(classes, cell.Style)
	b.WriteString(`<td class="`)
	b.WriteString(strings.Join(classes, " "))
	b.WriteByte('"')
	b.WriteString(mergeAttrs)
	writeInlineStyle(b, cell.Style)
	b.WriteByte('>')
	b.WriteString(escapeHTML(cell.Display))
	b.WriteString(`</td>`)
}

// writeInlineStyle assembles `style="color: …; background: …;
// font-size: …pt; font-family: …"` from the cell's open-vocabulary
// style fields. Each value is validated at emit time; invalid values
// (e.g. font family containing `(`) are dropped silently. Emits
// nothing when no declaration survives validation.
func writeInlineStyle(b *strings.Builder, style *CellStyle) {
	if style == nil {
		return
	}
	var decls []string
	if style.Font != nil {
		if v := strDeref(style.Font.Color); isSafeColorAttr(v) {
			decls = append(decls, "color: "+v)
		}
		if style.Font.Size != nil && *style.Font.Size > 0 {
			decls = append(decls, "font-size: "+formatFontSize(*style.Font.Size)+"pt")
		}
		if v := strDeref(style.Font.Name); isSafeFontFamily(v) {
			decls = append(decls, "font-family: "+v)
		}
	}
	if style.Fill != nil {
		// Prefer Fg (the canonical OOXML cell-color slot); fall back
		// to Bg for imported workbooks that stored the cell color
		// there (excelize does this for some patterns).
		v := strDeref(style.Fill.FgColor)
		if v == "" {
			v = strDeref(style.Fill.BgColor)
		}
		if isSafeColorAttr(v) {
			decls = append(decls, "background: "+v)
		}
	}
	if len(decls) == 0 {
		return
	}
	b.WriteString(` style="`)
	b.WriteString(escapeHTML(strings.Join(decls, "; ")))
	b.WriteByte('"')
}

// isSafeColorAttr accepts only well-formed hex (#abc / #aabbcc /
// #aabbccdd) or rgb()/rgba() with strictly numeric content. Excelize's
// import-side normalizers shouldn't produce anything outside this set;
// rejecting anything else stops a hostile workbook from smuggling
// `url(javascript:…)` etc. through the attribute.
func isSafeColorAttr(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" || len(s) > 32 {
		return false
	}
	if s[0] == '#' {
		// #abc / #aabb / #aabbcc / #aabbccaa
		hex := s[1:]
		switch len(hex) {
		case 3, 4, 6, 8:
		default:
			return false
		}
		for i := 0; i < len(hex); i++ {
			c := hex[i]
			switch {
			case c >= '0' && c <= '9',
				c >= 'a' && c <= 'f',
				c >= 'A' && c <= 'F':
			default:
				return false
			}
		}
		return true
	}
	// rgb(…) / rgba(…) — strict: digits, commas, spaces, dots, percent.
	lower := strings.ToLower(s)
	if !(strings.HasPrefix(lower, "rgb(") || strings.HasPrefix(lower, "rgba(")) {
		return false
	}
	if !strings.HasSuffix(s, ")") {
		return false
	}
	open := strings.IndexByte(s, '(')
	inner := s[open+1 : len(s)-1]
	for i := 0; i < len(inner); i++ {
		c := inner[i]
		switch {
		case c >= '0' && c <= '9',
			c == ',', c == ' ', c == '.', c == '%':
		default:
			return false
		}
	}
	return true
}

// isSafeFontFamily accepts a comma-separated list of family names made
// of letters, digits, spaces, hyphens, and quotes. Rejects any
// punctuation that would let an attacker break out into a different
// CSS context.
func isSafeFontFamily(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" || len(s) > 128 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'a' && c <= 'z',
			c >= 'A' && c <= 'Z',
			c >= '0' && c <= '9',
			c == ' ', c == '-', c == '_',
			c == ',', c == '"', c == '\'':
		default:
			return false
		}
	}
	return true
}

// formatFontSize formats a float pt size to a string with at most one
// decimal place. Most xlsx fonts are integer pt; the occasional half-pt
// (10.5pt) round-trips losslessly. We avoid strconv just for the rest
// of this package's no-strconv pattern.
func formatFontSize(v float64) string {
	if v == float64(int(v)) {
		return itoa(int(v))
	}
	// One decimal place. Multiplying then converting drops sub-tenth
	// precision; this is intentional — half-pt is the smallest unit
	// xlsx encodes.
	whole := int(v)
	tenths := int(v*10) - whole*10
	if tenths < 0 {
		tenths = -tenths
	}
	return itoa(whole) + "." + string(byte('0'+tenths))
}

// appendStyleClasses turns a CellStyle into a deterministic ordered
// set of `tinycld-calc-cell--*` class names. Style absence (nil) and
// each individual nil field mean "no contribution" — the rendered
// cell falls back to the default appearance from preview-css /
// print-css.
//
// The vocabulary intentionally favors semantic modifiers over
// arbitrary colors: we don't emit raw color values via class names
// (that would explode the class set), and inline `style=` is dropped
// by the sanitizer. The CSS counterpart will introduce custom
// properties for the data-dense subset (font color, fill color) in
// a later iteration. For Phase 1 we cover the boolean style flags
// and alignment, which carry the bulk of visual signal in
// representative workbooks.
func appendStyleClasses(classes []string, style *CellStyle) []string {
	if style == nil {
		return classes
	}
	if style.Font != nil {
		f := style.Font
		if isTrue(f.Bold) {
			classes = append(classes, "tinycld-calc-cell--bold")
		}
		if isTrue(f.Italic) {
			classes = append(classes, "tinycld-calc-cell--italic")
		}
		if isTrue(f.Underline) {
			classes = append(classes, "tinycld-calc-cell--underline")
		}
		if isTrue(f.Strike) {
			classes = append(classes, "tinycld-calc-cell--strike")
		}
	}
	if style.Alignment != nil {
		a := style.Alignment
		if a.Horizontal != nil {
			switch *a.Horizontal {
			case "left":
				classes = append(classes, "tinycld-calc-cell--align-left")
			case "center":
				classes = append(classes, "tinycld-calc-cell--align-center")
			case "right":
				classes = append(classes, "tinycld-calc-cell--align-right")
			}
		}
		if a.Vertical != nil {
			switch *a.Vertical {
			case "top":
				classes = append(classes, "tinycld-calc-cell--valign-top")
			case "middle":
				classes = append(classes, "tinycld-calc-cell--valign-middle")
			case "bottom":
				classes = append(classes, "tinycld-calc-cell--valign-bottom")
			}
		}
		if isTrue(a.WrapText) {
			classes = append(classes, "tinycld-calc-cell--wrap")
		}
	}
	if style.Borders != nil {
		bs := style.Borders
		if edgeIsPainted(bs.Top) {
			classes = append(classes, "tinycld-calc-cell--border-top")
		}
		if edgeIsPainted(bs.Right) {
			classes = append(classes, "tinycld-calc-cell--border-right")
		}
		if edgeIsPainted(bs.Bottom) {
			classes = append(classes, "tinycld-calc-cell--border-bottom")
		}
		if edgeIsPainted(bs.Left) {
			classes = append(classes, "tinycld-calc-cell--border-left")
		}
	}
	// Fill color is no longer surfaced as a boolean `--filled` class —
	// the data-bg attribute carries the actual color and the CSS
	// applies it via typed attr(). See writeDataStyleAttrs.
	return classes
}

func edgeIsPainted(e *CellBorderEdge) bool {
	if e == nil {
		return false
	}
	if e.IsClear {
		return false
	}
	return true
}

func isTrue(p *bool) bool {
	return p != nil && *p
}

func strDeref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// escapeHTML is the lone HTML-escape used for cell display text and
// sheet titles. The sanitizer enforces the structure of the
// surrounding markup; this helper enforces the leaf-text contract
// (text never reads back as markup).
func escapeHTML(s string) string {
	if !needsEscape(s) {
		return s
	}
	var b strings.Builder
	b.Grow(len(s) + 8)
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '&':
			b.WriteString("&amp;")
		case '<':
			b.WriteString("&lt;")
		case '>':
			b.WriteString("&gt;")
		case '"':
			b.WriteString("&quot;")
		case '\'':
			b.WriteString("&#39;")
		default:
			b.WriteByte(s[i])
		}
	}
	return b.String()
}

func needsEscape(s string) bool {
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '&', '<', '>', '"', '\'':
			return true
		}
	}
	return false
}
