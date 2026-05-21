package calc

import (
	"reflect"
	"slices"

	"github.com/xuri/excelize/v2"
)

// This file is the single source of truth for every leaf attribute on
// CellStyle. Each entry describes: a deterministic canary value the
// audit injects, an excelize read-back probe, and an extractor used by
// extractStyle's override map for the not-1:1 paths.
//
// Most entries are tiny — for structurally-1:1 paths the canary alone
// is enough; reflect handles the rest. Divergent paths (Font.Name ↔
// Font.Family, NumFmt ↔ CustomNumFmt, Borders, Fill) get an extractor
// and a custom read probe that lines up with their excelize shape.
//
// Adding a new CellStyle leaf:
//   - 1:1 with an excelize.Style field of the same name and type:
//     add a single entry here (canary only). overlayStyle picks it up
//     via reflect; extractStyle picks it up via reflect; the audit
//     verifies symmetry automatically.
//   - Not 1:1 (different field name, different type, or a non-trivial
//     mapping): add an entry here AND a matching overlay override in
//     styleOverlayOverrides (style_reflect.go). For the read side,
//     set ExtractFromExcelize on the registry entry.

// attributeProbe pulls a value out of an *excelize.Style at the given
// CellStyle path. Returns (value, true) when present, (nil, false)
// when absent — absent means "excelize doesn't carry this leaf", and
// after a round-trip means the writer lost it.
type attributeProbe func(*excelize.Style) (any, bool)

// attributeSpec describes one CellStyle leaf for the audit. Path is
// dotted Go field names rooted at CellStyle, matching the keys in
// styleOverlayOverrides.
type attributeSpec struct {
	// Canary is a deterministic non-zero value to inject when testing
	// this attribute in isolation. The audit constructs a *CellStyle
	// with just this leaf set to Canary and asserts it survives the
	// full pipeline.
	Canary any

	// CanaryReadBack is the value we expect to read back from excelize
	// (and the YDoc bootstrap) after a round-trip. Defaults to Canary
	// when nil. Diverges for attributes the writer normalizes — e.g.
	// "#FF8800" is accepted by the writer but excelize strips the "#"
	// before storing it, so CanaryReadBack is "FF8800".
	CanaryReadBack any

	// ReadFromExcelize returns the value of this leaf on an
	// *excelize.Style. Used by both extractStyle (to invert the
	// writer) and the audit (to verify the writer succeeded).
	ReadFromExcelize attributeProbe

	// ExtractTo writes the value (when present) into the matching
	// leaf on a *CellStyle. Only set for not-1:1 paths; nil means
	// "extractStyle handles this leaf structurally". The reflect walk
	// in extractStyle calls this *instead of* the structural copy.
	ExtractTo func(dst *CellStyle, value any)

	// CoRequiredPaths names other registry entries that must be set
	// alongside this leaf for the resulting CellStyle to be a valid
	// xlsx fill / border / etc. Used by the audit when this leaf in
	// isolation is not representable in OOXML.
	//
	// Example: Fill.FgColor alone is not a valid xlsx fill — OOXML
	// fills require both a Pattern code AND a Type. The audit
	// constructs a CellStyle with FgColor + Pattern + Type set
	// together to their respective canaries, then asserts only the
	// target leaf's round-trip (the others are independently audited
	// by their own iterations).
	CoRequiredPaths []string

	// ReadOnly marks an attribute that the writer cannot produce
	// from a doc-side edit but the reader must still extract from
	// imported xlsx files. Example: Fill.BgColor is meaningful for
	// hatched patterns but the writer only emits solid fills (which
	// reject a bg color). The audit verifies the read path via a
	// hand-rolled excelize.Style + extractStyle pass; the xlsx /
	// bootstrap legs are skipped because the overlay path cannot
	// represent the leaf.
	ReadOnly bool
}

// styleAttributeRegistry enumerates every leaf on CellStyle the writer
// must round-trip. The audit (style_roundtrip_audit_test.go) loops over
// this map; missing an entry for a new CellStyle leaf is the audit's
// own failure mode.
var styleAttributeRegistry = map[string]attributeSpec{
	"Font.Bold": {
		Canary:           true,
		ReadFromExcelize: probeFontBool(func(f *excelize.Font) bool { return f.Bold }),
	},
	"Font.Italic": {
		Canary:           true,
		ReadFromExcelize: probeFontBool(func(f *excelize.Font) bool { return f.Italic }),
	},
	"Font.Strike": {
		Canary:           true,
		ReadFromExcelize: probeFontBool(func(f *excelize.Font) bool { return f.Strike }),
	},
	"Font.Underline": {
		Canary: true,
		ReadFromExcelize: func(s *excelize.Style) (any, bool) {
			if s == nil || s.Font == nil {
				return nil, false
			}
			// excelize uses "single"/"double" for the underline variants and
			// "none"/"" when the attribute isn't set. The writer only ever
			// produces "single" or "none"; on read we collapse anything
			// non-empty and non-"none" to a single underlined-bool. See the
			// rationale in the plan: lossy on save, but consistent with the
			// "borders are uniform thin black" simplification — keeps an
			// externally-double-underlined cell visibly underlined.
			u := s.Font.Underline
			if u == "" || u == "none" {
				return nil, false
			}
			return true, true
		},
		ExtractTo: func(dst *CellStyle, value any) {
			if dst.Font == nil {
				dst.Font = &CellFont{}
			}
			b := value.(bool)
			dst.Font.Underline = &b
		},
	},
	"Font.Size": {
		Canary:           13.5,
		ReadFromExcelize: probeFontFloat(func(f *excelize.Font) float64 { return f.Size }),
	},
	"Font.Name": {
		Canary: "Courier New",
		ReadFromExcelize: func(s *excelize.Style) (any, bool) {
			if s == nil || s.Font == nil || s.Font.Family == "" {
				return nil, false
			}
			return s.Font.Family, true
		},
		ExtractTo: func(dst *CellStyle, value any) {
			if dst.Font == nil {
				dst.Font = &CellFont{}
			}
			s := value.(string)
			dst.Font.Name = &s
		},
	},
	"Font.Color": {
		Canary:         "#112233",
		CanaryReadBack: "112233",
		ReadFromExcelize: func(s *excelize.Style) (any, bool) {
			if s == nil || s.Font == nil || s.Font.Color == "" {
				return nil, false
			}
			return normalizeHex(s.Font.Color), true
		},
	},
	"NumFmt": {
		Canary: "#,##0.00",
		ReadFromExcelize: func(s *excelize.Style) (any, bool) {
			if s == nil || s.CustomNumFmt == nil || *s.CustomNumFmt == "" {
				return nil, false
			}
			return *s.CustomNumFmt, true
		},
		ExtractTo: func(dst *CellStyle, value any) {
			s := value.(string)
			dst.NumFmt = &s
		},
	},
	"Alignment.Horizontal": {
		Canary:           "right",
		ReadFromExcelize: probeAlignmentString(func(a *excelize.Alignment) string { return a.Horizontal }),
	},
	"Alignment.Vertical": {
		Canary:           "middle",
		ReadFromExcelize: probeAlignmentString(func(a *excelize.Alignment) string { return a.Vertical }),
	},
	"Alignment.WrapText": {
		Canary: true,
		ReadFromExcelize: func(s *excelize.Style) (any, bool) {
			if s == nil || s.Alignment == nil {
				return nil, false
			}
			if !s.Alignment.WrapText {
				return nil, false
			}
			return true, true
		},
	},
	// Fill.Type / Fill.Pattern / Fill.FgColor are co-dependent: an
	// OOXML fill record needs a non-zero Pattern code plus exactly one
	// foreground color (for "solid"). Auditing any one of these in
	// isolation produces an xlsx with no fill at all (excelize drops
	// the empty-color "solid" pattern) or a NewStyle error (a "pattern"
	// type with only a background color). The audit sets all three
	// together when checking any of them — the per-leaf assertion
	// still tests one leaf's round-trip; the others ride along as
	// "valid fill" scaffolding and are independently audited by
	// their own iterations.
	"Fill.Type": {
		Canary:           "pattern",
		ReadFromExcelize: probeFillString(func(f excelize.Fill) string { return f.Type }),
		ExtractTo: func(dst *CellStyle, value any) {
			if dst.Fill == nil {
				dst.Fill = &CellFill{}
			}
			s := value.(string)
			dst.Fill.Type = &s
		},
		CoRequiredPaths: []string{"Fill.Pattern", "Fill.FgColor"},
	},
	"Fill.Pattern": {
		Canary: "solid",
		ReadFromExcelize: func(s *excelize.Style) (any, bool) {
			if s == nil {
				return nil, false
			}
			// We model only "solid" vs. unset today. Any positive non-1
			// pattern (hatched, etc.) from an external editor collapses
			// to "solid" so the fill color stays visible — see plan
			// rationale (lossy on save, faithful to user intent on read).
			if s.Fill.Pattern == 0 {
				return nil, false
			}
			return "solid", true
		},
		ExtractTo: func(dst *CellStyle, value any) {
			if dst.Fill == nil {
				dst.Fill = &CellFill{}
			}
			s := value.(string)
			dst.Fill.Pattern = &s
		},
		CoRequiredPaths: []string{"Fill.Type", "Fill.FgColor"},
	},
	"Fill.FgColor": {
		Canary:         "#FF8800",
		CanaryReadBack: "FF8800",
		ReadFromExcelize: func(s *excelize.Style) (any, bool) {
			if s == nil || len(s.Fill.Color) == 0 || s.Fill.Color[0] == "" {
				return nil, false
			}
			return normalizeHex(s.Fill.Color[0]), true
		},
		ExtractTo: func(dst *CellStyle, value any) {
			if dst.Fill == nil {
				dst.Fill = &CellFill{}
			}
			s := value.(string)
			dst.Fill.FgColor = &s
		},
		// FgColor on its own (no Pattern/Type) currently relies on
		// overlayStyle's defensive default of Pattern=solid + Type=pattern
		// to produce a valid xlsx. That works — but to keep the audit
		// from depending on that fallback (which would mask a future
		// regression in the default), we still flag the OOXML
		// co-requirements explicitly.
		CoRequiredPaths: []string{"Fill.Type", "Fill.Pattern"},
	},
	// Fill.BgColor is read-only end-to-end. In OOXML, bgColor is
	// meaningful only for non-solid (hatched) patterns; the writer
	// currently emits only solid fills (Pattern=1), which excelize
	// rejects as invalid when paired with two colors. The TS side
	// uses bgColor only as a read-side fallback for imported xlsx
	// files that stored the cell color in the bgColor slot — the
	// toolbar never produces a bgColor edit. The audit honors that
	// asymmetry: the read leg must work (an imported sheet with
	// bgColor must surface it), the write leg is skipped.
	"Fill.BgColor": {
		Canary:         "001122",
		CanaryReadBack: "001122",
		ReadFromExcelize: func(s *excelize.Style) (any, bool) {
			if s == nil || len(s.Fill.Color) < 2 || s.Fill.Color[1] == "" {
				return nil, false
			}
			return normalizeHex(s.Fill.Color[1]), true
		},
		ExtractTo: func(dst *CellStyle, value any) {
			if dst.Fill == nil {
				dst.Fill = &CellFill{}
			}
			s := value.(string)
			dst.Fill.BgColor = &s
		},
		ReadOnly: true,
	},
	// Per-edge leaves — the audit auto-discovers these via reflection
	// over CellBorders → CellBorderEdge → {Style, Color}. Each style /
	// color entry uses a per-edge canary so an accidental cross-edge
	// swap surfaces immediately. The clear-signal (false on the wire,
	// IsClear=true in Go) is NOT in the leaf walk; it's covered by
	// TestSerializerStyleClearViaFalseWire in serializer_test.go.
	"Borders.Top.Style": {
		Canary:           "thin",
		ReadFromExcelize: probeBorderStyle("top"),
		ExtractTo:        extractBorderEdgeStyle("Top"),
	},
	"Borders.Top.Color": {
		Canary:           "#FF8800",
		CanaryReadBack:   "FF8800",
		ReadFromExcelize: probeBorderColor("top"),
		ExtractTo:        extractBorderEdgeColor("Top"),
	},
	"Borders.Right.Style": {
		Canary:           "medium",
		ReadFromExcelize: probeBorderStyle("right"),
		ExtractTo:        extractBorderEdgeStyle("Right"),
	},
	"Borders.Right.Color": {
		Canary:           "#FF8800",
		CanaryReadBack:   "FF8800",
		ReadFromExcelize: probeBorderColor("right"),
		ExtractTo:        extractBorderEdgeColor("Right"),
	},
	"Borders.Bottom.Style": {
		Canary:           "dashed",
		ReadFromExcelize: probeBorderStyle("bottom"),
		ExtractTo:        extractBorderEdgeStyle("Bottom"),
	},
	"Borders.Bottom.Color": {
		Canary:           "#FF8800",
		CanaryReadBack:   "FF8800",
		ReadFromExcelize: probeBorderColor("bottom"),
		ExtractTo:        extractBorderEdgeColor("Bottom"),
	},
	"Borders.Left.Style": {
		Canary:           "double",
		ReadFromExcelize: probeBorderStyle("left"),
		ExtractTo:        extractBorderEdgeStyle("Left"),
	},
	"Borders.Left.Color": {
		Canary:           "#FF8800",
		CanaryReadBack:   "FF8800",
		ReadFromExcelize: probeBorderColor("left"),
		ExtractTo:        extractBorderEdgeColor("Left"),
	},
}

func probeFontBool(get func(*excelize.Font) bool) attributeProbe {
	return func(s *excelize.Style) (any, bool) {
		if s == nil || s.Font == nil {
			return nil, false
		}
		v := get(s.Font)
		if !v {
			return nil, false
		}
		return true, true
	}
}

func probeFontFloat(get func(*excelize.Font) float64) attributeProbe {
	return func(s *excelize.Style) (any, bool) {
		if s == nil || s.Font == nil {
			return nil, false
		}
		v := get(s.Font)
		if v == 0 {
			return nil, false
		}
		return v, true
	}
}

func probeAlignmentString(get func(*excelize.Alignment) string) attributeProbe {
	return func(s *excelize.Style) (any, bool) {
		if s == nil || s.Alignment == nil {
			return nil, false
		}
		v := get(s.Alignment)
		if v == "" {
			return nil, false
		}
		return v, true
	}
}

func probeFillString(get func(excelize.Fill) string) attributeProbe {
	return func(s *excelize.Style) (any, bool) {
		if s == nil {
			return nil, false
		}
		v := get(s.Fill)
		if v == "" {
			return nil, false
		}
		return v, true
	}
}

func probeBorderStyle(edge string) attributeProbe {
	return func(s *excelize.Style) (any, bool) {
		if s == nil {
			return nil, false
		}
		for _, b := range s.Border {
			if b.Type == edge {
				if b.Style == 0 {
					return nil, false
				}
				return borderStyleNameForCode(b.Style), true
			}
		}
		return nil, false
	}
}

func probeBorderColor(edge string) attributeProbe {
	return func(s *excelize.Style) (any, bool) {
		if s == nil {
			return nil, false
		}
		for _, b := range s.Border {
			if b.Type == edge {
				if b.Color == "" {
					return nil, false
				}
				return normalizeHex(b.Color), true
			}
		}
		return nil, false
	}
}

func ensureBorderEdge(dst *CellStyle, goField string) *CellBorderEdge {
	if dst.Borders == nil {
		dst.Borders = &CellBorders{}
	}
	bordersValue := reflect.ValueOf(dst.Borders).Elem()
	field := bordersValue.FieldByName(goField)
	if field.IsNil() {
		field.Set(reflect.New(field.Type().Elem()))
	}
	return field.Interface().(*CellBorderEdge)
}

func extractBorderEdgeStyle(goField string) func(*CellStyle, any) {
	return func(dst *CellStyle, value any) {
		edge := ensureBorderEdge(dst, goField)
		s := value.(string)
		edge.Style = &s
	}
}

func extractBorderEdgeColor(goField string) func(*CellStyle, any) {
	return func(dst *CellStyle, value any) {
		edge := ensureBorderEdge(dst, goField)
		s := value.(string)
		edge.Color = &s
	}
}

// normalizeHex strips a leading "#" if present. excelize stores hex
// colors without the prefix; the doc-side canonical form is also bare
// hex. Callers feed both shapes through this before comparison or
// extraction so canaries that originated as "#RRGGBB" round-trip
// cleanly.
func normalizeHex(s string) string {
	if len(s) > 0 && s[0] == '#' {
		return s[1:]
	}
	return s
}

// styleAttributePaths returns every registered path in alphabetical
// order — deterministic iteration matters in audit failure messages.
func styleAttributePaths() []string {
	out := make([]string, 0, len(styleAttributeRegistry))
	for p := range styleAttributeRegistry {
		out = append(out, p)
	}
	slices.Sort(out)
	return out
}
