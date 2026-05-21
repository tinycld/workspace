package calc

import (
	"encoding/json"
	"sort"
	"strings"

	"github.com/xuri/excelize/v2"
)

// Conditional formatting round-trip between excelize and the doc-side
// rule model.
//
// excelize's vocabulary (Type field) overlaps with ours but doesn't
// match 1:1:
//   - "cell" + Criteria operator => our number* family
//   - "text" + Criteria          => our text* family
//   - "time_period"              => our date* family (subset)
//   - "blanks" / "no_blanks"     => our isEmpty / isNotEmpty
//   - "expression"               => our customFormula
//   - "duplicate" / "unique" / "top" / "bottom" / "average" /
//     "errors" / "no_errors" / "2_color_scale" / "3_color_scale" /
//     "data_bar" / "icon_set"    => round-trip as 'xlsxOpaque'
//
// The dxf style (Format index) reads via GetConditionalStyle and
// writes via NewConditionalStyle. We restrict the round-trip to the
// font + fill subset that v1 of the authoring UI offers; anything
// else excelize provides comes back through extractStyle and rides
// the same shape.

// readConditionalFormats pulls every CF rule excelize sees on a sheet
// and converts to ConditionalFormatRule. Map iteration order is
// non-deterministic; we sort by range string so the bootstrap output
// is stable across runs (lets tests assert exact equality).
func readConditionalFormats(f *excelize.File, sheetName string) ([]ConditionalFormatRule, error) {
	formats, err := f.GetConditionalFormats(sheetName)
	if err != nil {
		return nil, err
	}
	if len(formats) == 0 {
		return nil, nil
	}
	rangeRefs := make([]string, 0, len(formats))
	for ref := range formats {
		rangeRefs = append(rangeRefs, ref)
	}
	sort.Strings(rangeRefs)

	out := make([]ConditionalFormatRule, 0, len(formats))
	for _, rangeRef := range rangeRefs {
		opts := formats[rangeRef]
		// One xlsx range may carry multiple rules (the priority
		// stack). Each rule gets its own ConditionalFormatRule entry.
		// We deliberately do NOT merge rules with identical conditions
		// across ranges — the doc-side model is "rule owns ranges"
		// while xlsx is "range owns rules"; the inverse mapping
		// would lose information.
		for i := range opts {
			rule := excelizeOptionsToRule(rangeRef, &opts[i])
			if i == 0 {
				rule.ID = "xlsx:" + rangeRef
			} else {
				rule.ID = "xlsx:" + rangeRef + ":" + sortableIndex(i)
			}
			rule.Style = readConditionalDxfStyle(f, opts[i].Format)
			out = append(out, rule)
		}
	}
	return out, nil
}

func sortableIndex(i int) string {
	const digits = "0123456789"
	if i < 10 {
		return string(digits[i])
	}
	// Fallback for the (unlikely) case of >10 stacked rules.
	return string(digits[i%10]) + sortableIndex(i/10)
}

func excelizeOptionsToRule(rangeRef string, opt *excelize.ConditionalFormatOptions) ConditionalFormatRule {
	rule := ConditionalFormatRule{
		Ranges: []string{rangeRef},
	}
	switch opt.Type {
	case "cell":
		rule.Condition = mapCellCondition(opt)
	case "text":
		rule.Condition = mapTextCondition(opt)
	case "time_period":
		rule.Condition = mapTimePeriodCondition(opt)
	case "blanks":
		rule.Condition = ConditionalCondition{Type: "isEmpty"}
	case "no_blanks":
		rule.Condition = ConditionalCondition{Type: "isNotEmpty"}
	case "expression", "formula":
		formula := opt.Criteria
		formula = strings.TrimPrefix(formula, "=")
		rule.Condition = ConditionalCondition{Type: "customFormula", Formula: &formula}
	default:
		rule.Condition = mapOpaqueCondition(opt)
	}
	return rule
}

func mapCellCondition(opt *excelize.ConditionalFormatOptions) ConditionalCondition {
	v1 := opt.Value
	switch normalizeCriteria(opt.Criteria) {
	case "==":
		return ConditionalCondition{Type: "numberEquals", Value1: &v1}
	case "!=":
		return ConditionalCondition{Type: "numberNotEquals", Value1: &v1}
	case ">":
		return ConditionalCondition{Type: "numberGreater", Value1: &v1}
	case ">=":
		return ConditionalCondition{Type: "numberGreaterOrEqual", Value1: &v1}
	case "<":
		return ConditionalCondition{Type: "numberLess", Value1: &v1}
	case "<=":
		return ConditionalCondition{Type: "numberLessOrEqual", Value1: &v1}
	case "between":
		v2 := opt.MaxValue
		min := opt.MinValue
		return ConditionalCondition{Type: "numberBetween", Value1: &min, Value2: &v2}
	case "not between":
		v2 := opt.MaxValue
		min := opt.MinValue
		return ConditionalCondition{Type: "numberNotBetween", Value1: &min, Value2: &v2}
	}
	return mapOpaqueCondition(opt)
}

func mapTextCondition(opt *excelize.ConditionalFormatOptions) ConditionalCondition {
	v1 := opt.Value
	switch strings.ToLower(strings.TrimSpace(opt.Criteria)) {
	case "containing", "contains":
		return ConditionalCondition{Type: "textContains", Value1: &v1}
	case "not containing":
		return ConditionalCondition{Type: "textDoesNotContain", Value1: &v1}
	case "begins with", "starts with":
		return ConditionalCondition{Type: "textStartsWith", Value1: &v1}
	case "ends with":
		return ConditionalCondition{Type: "textEndsWith", Value1: &v1}
	case "equal to", "==":
		return ConditionalCondition{Type: "textEquals", Value1: &v1}
	}
	return mapOpaqueCondition(opt)
}

// mapTimePeriodCondition handles excelize's "time_period" type. Its
// criteria are relative ("yesterday", "today", "last 7 days") which
// the v1 authoring UI doesn't model; the only one we map to a
// native condition is exact-date matches, which excelize doesn't
// surface as time_period (those come through the "cell" type with a
// date value). So time_period always round-trips as opaque.
func mapTimePeriodCondition(opt *excelize.ConditionalFormatOptions) ConditionalCondition {
	return mapOpaqueCondition(opt)
}

func mapOpaqueCondition(opt *excelize.ConditionalFormatOptions) ConditionalCondition {
	// Round-trip the whole excelize options blob as JSON-serializable
	// map so the serializer can re-emit it verbatim on save. JSON
	// here is just a "deep clone via the language's reflect path";
	// the doc stores it as a nested Y.Map.
	raw, err := json.Marshal(opt)
	if err != nil {
		return ConditionalCondition{Type: "xlsxOpaque"}
	}
	var blob map[string]interface{}
	if err := json.Unmarshal(raw, &blob); err != nil {
		return ConditionalCondition{Type: "xlsxOpaque"}
	}
	return ConditionalCondition{Type: "xlsxOpaque", OpaqueXlsx: blob}
}

// normalizeCriteria collapses excelize's two accepted criteria
// dialects (textual "greater than" vs symbolic ">") onto a single
// symbolic key.
func normalizeCriteria(c string) string {
	switch strings.ToLower(strings.TrimSpace(c)) {
	case "equal to", "==":
		return "=="
	case "not equal to", "!=":
		return "!="
	case "greater than", ">":
		return ">"
	case "greater than or equal to", ">=":
		return ">="
	case "less than", "<":
		return "<"
	case "less than or equal to", "<=":
		return "<="
	case "between":
		return "between"
	case "not between":
		return "not between"
	}
	return strings.ToLower(strings.TrimSpace(c))
}

// readConditionalDxfStyle resolves the differential format index a CF
// rule points at into a *CellStyle. excelize 2.10.1's
// GetConditionalStyle returns the registered dxf style; we route it
// through extractStyle (the same code path cell styles use) so font
// + fill + alignment + borders + numFmt all round-trip.
//
// Returns nil when the rule has no format (some rules just stop
// propagation) or the lookup fails. The serializer treats nil as
// "no style overlay".
func readConditionalDxfStyle(f *excelize.File, idx *int) *CellStyle {
	if idx == nil {
		return nil
	}
	style, err := f.GetConditionalStyle(*idx)
	if err != nil || style == nil {
		return nil
	}
	return extractStyle(style)
}

// writeConditionalFormats serializes a sheet's rules back into xlsx.
// Called from persist.go's serializeSnapshotToXLSX after the per-
// sheet cell writes and before pivots.
//
// Two conventions:
//   - one excelize SetConditionalFormat call per range. Multiple
//     ranges on a doc-side rule produce multiple calls with the same
//     options (excelize SetConditionalFormat accepts a comma-
//     separated rangeRef too, but per-call is clearer for testing).
//   - opaque-passthrough rules re-emit their stored OpaqueXlsx blob
//     via json round-trip back into excelize options.
func writeConditionalFormats(f *excelize.File, sheetName string, rules []ConditionalFormatRule) error {
	for _, rule := range rules {
		opts, err := ruleToExcelizeOptions(f, &rule)
		if err != nil {
			return err
		}
		if len(opts) == 0 {
			continue
		}
		for _, rangeRef := range rule.Ranges {
			if rangeRef == "" {
				continue
			}
			if err := f.SetConditionalFormat(sheetName, rangeRef, opts); err != nil {
				return err
			}
		}
	}
	return nil
}

func ruleToExcelizeOptions(f *excelize.File, rule *ConditionalFormatRule) ([]excelize.ConditionalFormatOptions, error) {
	if rule.Condition.Type == "xlsxOpaque" {
		return restoreOpaqueOptions(f, rule)
	}
	opt := excelize.ConditionalFormatOptions{}
	switch rule.Condition.Type {
	case "isEmpty":
		opt.Type = "blanks"
	case "isNotEmpty":
		opt.Type = "no_blanks"
	case "textContains":
		opt.Type = "text"
		opt.Criteria = "containing"
		opt.Value = derefString(rule.Condition.Value1)
	case "textDoesNotContain":
		opt.Type = "text"
		opt.Criteria = "not containing"
		opt.Value = derefString(rule.Condition.Value1)
	case "textStartsWith":
		opt.Type = "text"
		opt.Criteria = "begins with"
		opt.Value = derefString(rule.Condition.Value1)
	case "textEndsWith":
		opt.Type = "text"
		opt.Criteria = "ends with"
		opt.Value = derefString(rule.Condition.Value1)
	case "textEquals":
		opt.Type = "text"
		opt.Criteria = "equal to"
		opt.Value = derefString(rule.Condition.Value1)
	case "dateIs", "dateBefore", "dateAfter":
		// Date conditions round-trip as cell-value comparisons against
		// the operand interpreted as a date serial. The Excel side
		// will display it as a date because the cell's number format
		// already does; our condition value is the literal serial /
		// ISO operand text the doc carries.
		opt.Type = "cell"
		opt.Value = derefString(rule.Condition.Value1)
		switch rule.Condition.Type {
		case "dateIs":
			opt.Criteria = "equal to"
		case "dateBefore":
			opt.Criteria = "less than"
		case "dateAfter":
			opt.Criteria = "greater than"
		}
	case "numberEquals":
		opt.Type = "cell"
		opt.Criteria = "equal to"
		opt.Value = derefString(rule.Condition.Value1)
	case "numberNotEquals":
		opt.Type = "cell"
		opt.Criteria = "not equal to"
		opt.Value = derefString(rule.Condition.Value1)
	case "numberGreater":
		opt.Type = "cell"
		opt.Criteria = "greater than"
		opt.Value = derefString(rule.Condition.Value1)
	case "numberGreaterOrEqual":
		opt.Type = "cell"
		opt.Criteria = "greater than or equal to"
		opt.Value = derefString(rule.Condition.Value1)
	case "numberLess":
		opt.Type = "cell"
		opt.Criteria = "less than"
		opt.Value = derefString(rule.Condition.Value1)
	case "numberLessOrEqual":
		opt.Type = "cell"
		opt.Criteria = "less than or equal to"
		opt.Value = derefString(rule.Condition.Value1)
	case "numberBetween":
		opt.Type = "cell"
		opt.Criteria = "between"
		opt.MinValue = derefString(rule.Condition.Value1)
		opt.MaxValue = derefString(rule.Condition.Value2)
	case "numberNotBetween":
		opt.Type = "cell"
		opt.Criteria = "not between"
		opt.MinValue = derefString(rule.Condition.Value1)
		opt.MaxValue = derefString(rule.Condition.Value2)
	case "customFormula":
		opt.Type = "formula"
		formula := derefString(rule.Condition.Formula)
		if formula != "" && !strings.HasPrefix(formula, "=") {
			formula = "=" + formula
		}
		opt.Criteria = formula
	default:
		// Unknown native type — skip rather than corrupting the file.
		return nil, nil
	}
	if rule.Style != nil {
		styleIdx, err := newConditionalDxfStyle(f, rule.Style)
		if err != nil {
			return nil, err
		}
		opt.Format = &styleIdx
	}
	return []excelize.ConditionalFormatOptions{opt}, nil
}

// restoreOpaqueOptions re-marshals the stored opaqueXlsx blob back
// into an excelize.ConditionalFormatOptions. The blob carries every
// field excelize exposed at import time — Type, Criteria, Min/Max
// values, color-scale stops, icon-set names, etc. JSON round-trip is
// the simplest deep-copy mechanism.
func restoreOpaqueOptions(f *excelize.File, rule *ConditionalFormatRule) ([]excelize.ConditionalFormatOptions, error) {
	if rule.Condition.OpaqueXlsx == nil {
		return nil, nil
	}
	raw, err := json.Marshal(rule.Condition.OpaqueXlsx)
	if err != nil {
		return nil, err
	}
	var opt excelize.ConditionalFormatOptions
	if err := json.Unmarshal(raw, &opt); err != nil {
		return nil, err
	}
	// The opaque blob's Format pointer references a dxf id from the
	// *source* workbook. We have no guarantee that id still resolves
	// in the destination workbook (it would when we're writing back
	// to the same xlsx, but on a fresh save the dxfs table is
	// rebuilt). If we kept a doc-side style, re-register it; else
	// drop the format reference so excelize doesn't dangle.
	if rule.Style != nil {
		idx, err := newConditionalDxfStyle(f, rule.Style)
		if err != nil {
			return nil, err
		}
		opt.Format = &idx
	}
	return []excelize.ConditionalFormatOptions{opt}, nil
}

// newConditionalDxfStyle materializes a doc-side CellStyle as a new
// dxf entry in the workbook and returns its index. We rebuild on
// every save rather than try to dedupe — excelize will compact
// equivalent dxfs internally and the dxf table is cheap.
//
// dxf-specific fill quirk: excelize validates `Fill.Color` against
// `Fill.Pattern` differently for conditional styles than for cell
// styles. Pattern="pattern" requires exactly one color entry. The
// regular overlayStyle path produces two entries [fg, bg]; we trim
// to a single entry here. The fg slot wins (which matches what a
// user picks via the "fill color" swatch — the same slot dxf solid
// fills land on in Excel).
func newConditionalDxfStyle(f *excelize.File, style *CellStyle) (int, error) {
	base := &excelize.Style{}
	overlayStyle(base, style)
	if base.Fill.Type != "" && len(base.Fill.Color) > 1 {
		base.Fill.Color = base.Fill.Color[:1]
	}
	return f.NewConditionalStyle(base)
}

func derefString(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
