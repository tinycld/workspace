package calc

import (
	"reflect"
	"slices"

	"github.com/xuri/excelize/v2"
)

// This file holds the single reflect-driven layer in the calc save
// path: overlayStyle, which copies a *CellStyle (snapshot.go) onto an
// *excelize.Style (excelize's monolithic per-cell style record).
//
// The reverse direction — turning the y-crdt-decoded style YMap into
// a *CellStyle — does NOT use reflect: runtime.go's decodeCellStyle
// flattens the style YMap into a plain map and json.Marshals it, then
// json.Unmarshals straight into *CellStyle using the standard
// library's tag-driven decoder. CellStyle's TS / Go field names are
// chosen to match the camelCase keys the doc uses (see the json tags
// in snapshot.go), so no per-attribute glue is needed.
//
// The overlay direction needs reflect because excelize's struct shape
// doesn't line up with our CellStyle 1:1 in every case. Most attributes
// (Bold, Italic, Color, Horizontal, Vertical, WrapText, Size) match by
// name and convertible type; a small number diverge (e.g.
// CellStyle.NumFmt → excelize.Style.CustomNumFmt; CellFont.Name →
// excelize.Font.Family). The structural fields round-trip with no
// per-attribute code; the divergent ones declare a single override
// in styleOverlayOverrides.
//
// Adding a new attribute that lines up structurally: add one field on
// CellStyle / CellFont / etc. in snapshot.go (matching excelize's
// PascalCase) AND one matching camelCase field on the TS CellStyle.
// Done — no changes here.
//
// Adding a non-structural attribute: same plus one entry in
// styleOverlayOverrides below. Override the most specific path that
// applies — e.g. "Font.Underline" rather than "Font" if only one
// font field diverges.

// styleOverlayOverride is the per-attribute escape hatch for fields
// where CellStyle's Go shape doesn't line up 1:1 with excelize's
// shape. Path is dotted Go field names rooted at CellStyle, e.g.
// "Font.Name" or "NumFmt".
//
// Whole-group overrides (path == "Fill" or "Borders") short-circuit
// the structural walk for that group: the override decides what
// happens for every sub-field, including how to merge with existing
// values on dst. Use a group override when the excelize shape
// diverges in more than one place under the same group (e.g. Fill's
// Pattern is an int enum AND its Color is a []string, not a struct).
type styleOverlayOverride func(dst *excelize.Style, srcPtr reflect.Value)

var styleOverlayOverrides = map[string]styleOverlayOverride{
	"Font.Underline": func(dst *excelize.Style, srcPtr reflect.Value) {
		if dst.Font == nil {
			dst.Font = &excelize.Font{}
		}
		if srcPtr.Elem().Bool() {
			dst.Font.Underline = "single"
		} else {
			dst.Font.Underline = "none"
		}
	},
	"Font.Name": func(dst *excelize.Style, srcPtr reflect.Value) {
		if dst.Font == nil {
			dst.Font = &excelize.Font{}
		}
		dst.Font.Family = srcPtr.Elem().String()
	},
	"NumFmt": func(dst *excelize.Style, srcPtr reflect.Value) {
		s := srcPtr.Elem().String()
		if s == "" {
			// excelize.NewStyle errors on a non-nil pointer to "" with
			// ErrCustomNumFmt. An empty-string patch means "clear the
			// custom format" — drop CustomNumFmt entirely so excelize
			// falls back to the workbook's General format.
			dst.CustomNumFmt = nil
			return
		}
		dst.CustomNumFmt = &s
	},
	"Borders": func(dst *excelize.Style, srcPtr reflect.Value) {
		src := srcPtr.Elem() // CellBorders struct
		edges := []struct {
			field string
			name  string
		}{
			{"Top", "top"},
			{"Right", "right"},
			{"Bottom", "bottom"},
			{"Left", "left"},
		}

		// Build a map of existing edges so we can overlay (non-mentioned
		// edges survive verbatim).
		existing := map[string]excelize.Border{}
		for _, b := range dst.Border {
			existing[b.Type] = b
		}

		for _, edge := range edges {
			f := src.FieldByName(edge.field)
			if f.IsNil() {
				continue
			}
			edgePtr := f.Interface().(*CellBorderEdge)
			if edgePtr.IsClear {
				delete(existing, edge.name)
				continue
			}
			styleCode := excelizeBorderStyleCode(edgePtr.Style)
			color := "000000"
			if edgePtr.Color != nil {
				color = stripHash(*edgePtr.Color)
			}
			existing[edge.name] = excelize.Border{
				Type:  edge.name,
				Color: color,
				Style: styleCode,
			}
		}

		// Reassemble: known edges in deterministic order, then any
		// edge types we don't model verbatim (diagonalUp, diagonalDown,
		// or future excelize additions). Map iteration order is
		// non-deterministic, but the schema edges always come first so the
		// common case stays stable; preserving unknown-typed entries here
		// avoids silently dropping diagonals from imported workbooks.
		out := make([]excelize.Border, 0, len(existing))
		for _, edge := range edges {
			if b, ok := existing[edge.name]; ok {
				out = append(out, b)
				delete(existing, edge.name)
			}
		}
		for _, b := range existing {
			out = append(out, b)
		}
		dst.Border = out
	},
	"Fill": func(dst *excelize.Style, srcPtr reflect.Value) {
		src := srcPtr.Elem() // CellFill struct
		if typ := src.FieldByName("Type"); !typ.IsNil() {
			dst.Fill.Type = typ.Elem().String()
		}
		if p := src.FieldByName("Pattern"); !p.IsNil() {
			switch p.Elem().String() {
			case "solid":
				dst.Fill.Pattern = 1
			default:
				dst.Fill.Pattern = 0
			}
		}
		fg := src.FieldByName("FgColor")
		bg := src.FieldByName("BgColor")
		if !fg.IsNil() || !bg.IsNil() {
			// Color is a []string with [foreground, background]. Preserve
			// any existing entries on dst, only overwriting the slots the
			// patch defines.
			colors := slices.Clone(dst.Fill.Color)
			for len(colors) < 2 {
				colors = append(colors, "")
			}
			if !fg.IsNil() {
				colors[0] = fg.Elem().String()
			}
			if !bg.IsNil() {
				colors[1] = bg.Elem().String()
			}
			// Trim trailing empties so excelize doesn't write blank slots.
			for len(colors) > 0 && colors[len(colors)-1] == "" {
				colors = colors[:len(colors)-1]
			}
			dst.Fill.Color = colors
			// excelize drops fill colors on serialize when Pattern==0
			// (no fill at all in OOXML terms). A doc-side patch that
			// supplies a color without an explicit pattern means "user
			// picked this color via the fill button"; honor that by
			// defaulting to solid pattern + pattern type. Without this,
			// a YDoc bg-color edit that doesn't also re-send the
			// pattern key would round-trip as no-op on disk.
			if dst.Fill.Pattern == 0 {
				dst.Fill.Pattern = 1
			}
			if dst.Fill.Type == "" {
				dst.Fill.Type = "pattern"
			}
		}
	},
}

// overlayStyle copies every non-nil leaf in patch onto the matching
// field path in base, mutating base in place.
//
// Most attributes round-trip via a structural walk: a non-nil
// CellStyle.Font.Bold lands on excelize.Font.Bold by name. Attributes
// whose names or types don't match are routed through
// styleOverlayOverrides instead.
func overlayStyle(base *excelize.Style, patch *CellStyle) {
	if patch == nil || base == nil {
		return
	}
	overlayWalk(reflect.ValueOf(base).Elem(), reflect.ValueOf(patch).Elem(), "", base)
}

// overlayWalk recurses through the patch struct and applies non-nil
// leaves onto base. The path arg accumulates the dotted Go field
// path (used to look up override handlers); rootDst stays anchored
// at the *excelize.Style so override handlers can target arbitrary
// fields anywhere on it.
func overlayWalk(dst, src reflect.Value, path string, rootDst *excelize.Style) {
	if src.Kind() != reflect.Struct {
		return
	}
	srcType := src.Type()
	for i := range src.NumField() {
		srcField := src.Field(i)
		if srcField.Kind() != reflect.Pointer || srcField.IsNil() {
			continue
		}
		name := srcType.Field(i).Name
		fieldPath := name
		if path != "" {
			fieldPath = path + "." + name
		}
		if handler, ok := styleOverlayOverrides[fieldPath]; ok {
			handler(rootDst, srcField)
			continue
		}
		dstField := dst.FieldByName(name)
		if !dstField.IsValid() || !dstField.CanSet() {
			continue
		}
		applyPointer(dstField, srcField, fieldPath, rootDst)
	}
}

// applyPointer assigns a non-nil src pointer onto dstField. dstField
// may be a pointer, a value-typed nested struct, or a scalar.
func applyPointer(dstField, srcPtr reflect.Value, path string, rootDst *excelize.Style) {
	srcElem := srcPtr.Elem()
	switch dstField.Kind() {
	case reflect.Pointer:
		elemType := dstField.Type().Elem()
		if dstField.IsNil() {
			dstField.Set(reflect.New(elemType))
		}
		if elemType.Kind() == reflect.Struct {
			overlayWalk(dstField.Elem(), srcElem, path, rootDst)
			return
		}
		if srcElem.Type().AssignableTo(elemType) {
			dstField.Elem().Set(srcElem)
		}
	case reflect.Struct:
		overlayWalk(dstField, srcElem, path, rootDst)
	default:
		if srcElem.Type().AssignableTo(dstField.Type()) {
			dstField.Set(srcElem)
		}
	}
}

// extractStyle is the read-side inverse of overlayStyle: walk every
// leaf the CellStyle schema knows about, probe the corresponding
// excelize.Style field via the registry, and assemble a *CellStyle
// carrying only the leaves excelize actually has values for. Returns
// nil when the input is structurally empty so callers (today
// readWorkbookCellStyle) can leave the doc-side style unset.
//
// Structurally 1:1 leaves (Font.Bold, Alignment.Horizontal, …) flow
// through the reflect walk: the probe returns a typed value, the walk
// copies it onto the same-named CellStyle field. Divergent leaves
// (Font.Name ↔ Font.Family, NumFmt ↔ CustomNumFmt, Borders, Fill)
// declare an ExtractTo on the registry entry, which writes to the
// CellStyle directly.
//
// This mirrors the writer's policy of "leaves only" — empty / zero /
// missing on the excelize side becomes "not tracked" (nil pointer) on
// the CellStyle side, which the doc / serializer interprets as "leave
// it alone on save". A workbook with no styled cells produces a nil
// *CellStyle here, exactly like the writer's nil-patch path.
func extractStyle(src *excelize.Style) *CellStyle {
	if src == nil {
		return nil
	}
	dst := &CellStyle{}
	for _, path := range styleAttributePaths() {
		spec := styleAttributeRegistry[path]
		probe := spec.ReadFromExcelize
		if probe == nil {
			continue
		}
		value, ok := probe(src)
		if !ok {
			continue
		}
		if spec.ExtractTo != nil {
			spec.ExtractTo(dst, value)
			continue
		}
		assignLeafByPath(dst, path, value)
	}
	if isEmptyCellStyle(dst) {
		return nil
	}
	return dst
}

// assignLeafByPath sets a CellStyle leaf at the dotted path to the
// given value, allocating the intermediate group struct (Font / Fill /
// Alignment / Borders) on demand. Used for the structurally-1:1
// leaves where extractStyle has no per-attribute override; the leaf
// field type drives the allocation (always *bool / *string /
// *float64 on CellStyle today).
func assignLeafByPath(dst *CellStyle, path string, value any) {
	v := reflect.ValueOf(dst).Elem()
	parts := splitDottedPath(path)
	for i, name := range parts {
		field := v.FieldByName(name)
		if !field.IsValid() {
			return
		}
		if i == len(parts)-1 {
			elem := field.Type().Elem()
			rv := reflect.ValueOf(value)
			if !rv.Type().AssignableTo(elem) {
				if !rv.Type().ConvertibleTo(elem) {
					return
				}
				rv = rv.Convert(elem)
			}
			ptr := reflect.New(elem)
			ptr.Elem().Set(rv)
			field.Set(ptr)
			return
		}
		if field.IsNil() {
			field.Set(reflect.New(field.Type().Elem()))
		}
		v = field.Elem()
	}
}

func splitDottedPath(path string) []string {
	out := make([]string, 0, 2)
	start := 0
	for i := 0; i < len(path); i++ {
		if path[i] == '.' {
			out = append(out, path[start:i])
			start = i + 1
		}
	}
	out = append(out, path[start:])
	return out
}

// isEmptyCellStyle returns true when every group on the style is nil
// or every leaf within each non-nil group is nil. Lets extractStyle
// return nil for cells that excelize merely registered an empty style
// for (common after a NewStyle({}) round-trip), matching the writer's
// nil-patch path.
func isEmptyCellStyle(cs *CellStyle) bool {
	if cs == nil {
		return true
	}
	if cs.NumFmt != nil {
		return false
	}
	if cs.Font != nil && !isEmptyStruct(reflect.ValueOf(cs.Font).Elem()) {
		return false
	}
	if cs.Fill != nil && !isEmptyStruct(reflect.ValueOf(cs.Fill).Elem()) {
		return false
	}
	if cs.Alignment != nil && !isEmptyStruct(reflect.ValueOf(cs.Alignment).Elem()) {
		return false
	}
	if cs.Borders != nil && !isEmptyStruct(reflect.ValueOf(cs.Borders).Elem()) {
		return false
	}
	return true
}

func isEmptyStruct(v reflect.Value) bool {
	for i := range v.NumField() {
		f := v.Field(i)
		if f.Kind() == reflect.Pointer && !f.IsNil() {
			return false
		}
	}
	return true
}

// excelizeBorderStyleCode maps a doc-side line style name to the
// excelize border style index. Reference: github.com/xuri/excelize/v2
// styles.go (the table near "Border styles supported by excelize").
//
//	1=thin (continuous weight 1), 2=medium (continuous weight 2),
//	3=dash, 4=dot, 5=thick (continuous weight 3), 6=double.
//
// Unknown / nil styles default to 1 (thin) so a partial edge written
// by an old client still produces a visible border.
func excelizeBorderStyleCode(style *string) int {
	if style == nil {
		return 1
	}
	switch *style {
	case "thin":
		return 1
	case "medium":
		return 2
	case "dashed":
		return 3
	case "dotted":
		return 4
	case "thick":
		return 5
	case "double":
		return 6
	}
	return 1
}

// borderStyleNameForCode is the inverse of excelizeBorderStyleCode for
// the read path. Codes outside the modeled set collapse to a sane
// fallback so an externally-authored xlsx with (e.g.) Dash Dot still
// surfaces a doc-side line style instead of silently disappearing.
func borderStyleNameForCode(code int) string {
	switch code {
	case 1:
		return "thin"
	case 2:
		return "medium"
	case 3, 8, 9, 10, 11, 12, 13:
		return "dashed"
	case 4:
		return "dotted"
	case 5:
		return "thick"
	case 6:
		return "double"
	}
	return "thin"
}

// stripHash drops a leading "#" from a hex color string so we can hand
// excelize the bare "RRGGBB" form it stores natively. Colors without a
// "#" prefix pass through unchanged.
func stripHash(s string) string {
	if len(s) > 0 && s[0] == '#' {
		return s[1:]
	}
	return s
}
