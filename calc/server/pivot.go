package calc

import (
	"fmt"
	"strings"

	"github.com/xuri/excelize/v2"
)

// PivotDefinitionDTO mirrors the TS PivotDefinition (see
// tinycld/calc/lib/workbook-types.ts). It is the wire shape for the
// preview endpoint and the YDoc bootstrap path. Field tags are
// camelCase JSON so it decodes byte-for-byte into the TS interface.
type PivotDefinitionDTO struct {
	ID               string               `json:"id"`
	SourceRange      string               `json:"sourceRange"`
	TargetSheetName  string               `json:"targetSheetName"`
	Rows             []PivotFieldDTO      `json:"rows"`
	Cols             []PivotFieldDTO      `json:"cols"`
	Values           []PivotValueFieldDTO `json:"values"`
	Filters          []PivotFieldDTO      `json:"filters"`
	FilterSelections map[string][]string  `json:"filterSelections,omitempty"`
	RowGrandTotals   bool                 `json:"rowGrandTotals"`
	ColGrandTotals   bool                 `json:"colGrandTotals"`
	RowSubtotals     bool                 `json:"rowSubtotals"`
	ColSubtotals     bool                 `json:"colSubtotals"`
	StyleName        string               `json:"styleName,omitempty"`
}

// PivotFieldDTO is the Rows/Cols/Filters per-field shape.
type PivotFieldDTO struct {
	SourceColumn string `json:"sourceColumn"`
	DisplayName  string `json:"displayName,omitempty"`
}

// PivotValueFieldDTO extends PivotFieldDTO with aggregation + numFmt.
// `Aggregation` values: sum, average, count, countNums, max, min,
// product, stdDev, stdDevp, var, varp (matches the TS PivotAggregation
// union).
//
// NumFmt is a free-form Excel format pattern (e.g. "#,##0.00") used by
// the TS-side render engine. It deliberately does NOT round-trip
// through xlsx: excelize's PivotTableField.NumFmt is an int (built-in
// numFmt ID) and only accepts that catalog, so a custom string
// pattern has nowhere to land. We carry the field on the DTO so the
// preview endpoint and Y.Doc bootstrap can ferry it from xlsx import
// (always empty today) to engine render, but the export path drops
// it. See docs/pivot.md for the divergence note.
type PivotValueFieldDTO struct {
	SourceColumn string `json:"sourceColumn"`
	DisplayName  string `json:"displayName,omitempty"`
	Aggregation  string `json:"aggregation"`
	NumFmt       string `json:"numFmt,omitempty"`
}

// readPivotsForSheet pulls excelize's PivotTableOptions and maps them
// onto PivotDefinitionDTO. excelize returns one PivotTableOptions per
// pivot whose target lives on the given sheet (the "anchor" — the
// sheet the user passed to AddPivotTable's PivotTableRange).
//
// The function does not promote in-sheet pivots to dedicated sheets;
// that is the caller's job (ensureDistinctTargets) so the collision
// rule can see the full sheet list, not just one anchor at a time.
func readPivotsForSheet(f *excelize.File, anchorSheet string) ([]PivotDefinitionDTO, error) {
	opts, err := f.GetPivotTables(anchorSheet)
	if err != nil {
		return nil, err
	}
	out := make([]PivotDefinitionDTO, 0, len(opts))
	for i, o := range opts {
		dto := PivotDefinitionDTO{
			ID:              fmt.Sprintf("p_%s_%d", sanitizeID(anchorSheet), i+1),
			SourceRange:     o.DataRange,
			TargetSheetName: extractSheetName(o.PivotTableRange, anchorSheet),
			Rows:            mapFields(o.Rows),
			Cols:            mapFields(o.Columns),
			Values:          mapValueFields(o.Data),
			Filters:         mapFields(o.Filter),
			RowGrandTotals:  o.RowGrandTotals,
			ColGrandTotals:  o.ColGrandTotals,
			StyleName:       o.PivotTableStyleName,
		}
		out = append(out, dto)
	}
	return out, nil
}

func mapFields(in []excelize.PivotTableField) []PivotFieldDTO {
	out := make([]PivotFieldDTO, 0, len(in))
	for _, f := range in {
		out = append(out, PivotFieldDTO{
			SourceColumn: f.Data,
			DisplayName:  fieldDisplayName(f),
		})
	}
	return out
}

func mapValueFields(in []excelize.PivotTableField) []PivotValueFieldDTO {
	out := make([]PivotValueFieldDTO, 0, len(in))
	for _, f := range in {
		out = append(out, PivotValueFieldDTO{
			SourceColumn: f.Data,
			DisplayName:  fieldDisplayName(f),
			Aggregation:  normalizeAgg(f.Subtotal),
		})
	}
	return out
}

func fieldDisplayName(f excelize.PivotTableField) string {
	if f.Name == "" || f.Name == f.Data {
		return ""
	}
	return f.Name
}

// extractSheetName returns the sheet name portion of an A1 range like
// "Sheet2!A1:F10". Falls back to the anchor sheet name if parsing
// fails — that preserves the design's promotion rule for in-sheet
// pivots (the caller renames if collision).
func extractSheetName(rangeStr, fallback string) string {
	if !strings.Contains(rangeStr, "!") {
		return fallback
	}
	parts := strings.SplitN(rangeStr, "!", 2)
	name := strings.TrimSpace(parts[0])
	if strings.HasPrefix(name, "'") && strings.HasSuffix(name, "'") && len(name) >= 2 {
		name = strings.ReplaceAll(name[1:len(name)-1], "''", "'")
	}
	if name == "" {
		return fallback
	}
	return name
}

// sanitizeID maps an arbitrary sheet name to a stable, ASCII-only id
// component. Used so the synthetic pivot ID is deterministic per
// import and doesn't depend on time.
func sanitizeID(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'A' && r <= 'Z',
			r >= 'a' && r <= 'z',
			r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == ' ':
			b.WriteRune('_')
		}
	}
	if b.Len() == 0 {
		return "sheet"
	}
	return b.String()
}

// normalizeAgg maps excelize's Subtotal strings to the lowercase
// PivotAggregation union the TS side uses.
func normalizeAgg(s string) string {
	switch strings.ToLower(s) {
	case "sum", "":
		return "sum"
	case "average":
		return "average"
	case "count":
		return "count"
	case "countnums":
		return "countNums"
	case "max":
		return "max"
	case "min":
		return "min"
	case "product":
		return "product"
	case "stddev":
		return "stdDev"
	case "stddevp":
		return "stdDevp"
	case "var":
		return "var"
	case "varp":
		return "varp"
	}
	return "sum"
}
