package calc

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"reflect"
	"strconv"
	"strings"
	"sync"

	ycrdt "github.com/skyterra/y-crdt"

	"tinycld.org/core/realtime"
)

// Runtime is the calc package's server-side Y.Doc registry. One per
// process; the broker calls NewDoc once per active room and the
// returned handle owns the room's mirror until Close.
//
// Backed by github.com/skyterra/y-crdt (a native-Go yjs decoder /
// encoder). Operations on a single Y.Doc serialize through that doc's
// own internal state machine; the per-room mutex below only guards the
// docs map itself.
type Runtime struct {
	// bootstrap, when non-nil, runs synchronously inside NewDoc with
	// the freshly-minted Y.Doc. Production wires this to load the
	// drive_items xlsx and stamp it into the doc, so the broker's
	// first SyncReply already carries populated sheets/cells. Tests
	// leave it nil — they construct doc state via ApplyUpdate.
	bootstrap func(roomID string, doc *ycrdt.Doc) error

	mu   sync.Mutex
	docs map[string]*ycrdt.Doc
}

// NewRuntime returns an empty Runtime. Cheap; no doc state is allocated
// until NewDoc is called.
func NewRuntime() *Runtime {
	return &Runtime{docs: map[string]*ycrdt.Doc{}}
}

// SetBootstrap registers a per-room bootstrap hook. NewDoc invokes the
// hook (if set) inside the same critical section that creates the doc,
// so MsgSyncRequest replies are guaranteed to see the populated state.
//
// A nil hook disables bootstrap (for tests). Passing nil after a hook
// has been registered clears it.
func (r *Runtime) SetBootstrap(hook func(roomID string, doc *ycrdt.Doc) error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.bootstrap = hook
}

// NewDoc satisfies realtime.DocRuntime: mints a fresh server-side
// Y.Doc identified by the broker's roomID and returns an opaque
// handle the broker calls into for the room's lifetime.
//
// If a bootstrap hook is registered, it runs synchronously after the
// doc is created. Bootstrap failures are logged but do not abort the
// room creation — a partially-bootstrapped (or empty) doc is preferable
// to refusing the connection, since a peer-driven SyncRequest path
// can still recover (the client treats an empty SyncReply as "you're
// alone" and previously fell back to its own xlsx parse).
func (r *Runtime) NewDoc(roomID string) (realtime.DocHandle, error) {
	r.mu.Lock()
	if _, exists := r.docs[roomID]; exists {
		r.mu.Unlock()
		return nil, fmt.Errorf("calc: room %s already has a Y.Doc", roomID)
	}
	doc := ycrdt.NewDoc(roomID, false, nil, nil, false)
	r.docs[roomID] = doc
	hook := r.bootstrap
	r.mu.Unlock()

	if hook != nil {
		if err := hook(roomID, doc); err != nil {
			slog.Warn("calc: bootstrap hook failed; room continues with empty doc",
				"roomID", roomID, "err", err)
		}
	}
	return &sheetsDocHandle{runtime: r, id: roomID, doc: doc}, nil
}

// closeDoc removes the doc from the registry. Returns true if the
// doc was registered. Safe to call multiple times.
func (r *Runtime) closeDoc(roomID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.docs[roomID]; !ok {
		return false
	}
	delete(r.docs, roomID)
	return true
}

// sheetsDocHandle is the broker's handle on one room's server-side
// Y.Doc.
type sheetsDocHandle struct {
	runtime *Runtime
	id      string

	mu     sync.Mutex
	doc    *ycrdt.Doc // nil after Close
	closed bool
}

// ApplyUpdate folds an inbound MsgDocUpdate payload into the server's
// mirror of the room's Y.Doc.
//
// y-crdt's ApplyUpdate logs and silently returns on malformed bytes
// rather than surfacing a decode error. The defer/recover guards
// against that contract regressing — a future panic-on-bad-input
// change in the library would otherwise take down the broker
// goroutine on hostile client input.
func (h *sheetsDocHandle) ApplyUpdate(payload []byte) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed || h.doc == nil {
		return fmt.Errorf("calc: ApplyUpdate on closed room %s", h.id)
	}
	var applyErr error
	func() {
		defer func() {
			if r := recover(); r != nil {
				applyErr = fmt.Errorf("calc: ApplyUpdate panic for room %s: %v", h.id, r)
			}
		}()
		ycrdt.ApplyUpdate(h.doc, payload, nil)
	}()
	return applyErr
}

// EncodeStateAsUpdate returns the bytes a new joiner needs to catch
// up to the room's current state. Wrapped by the broker in a
// MsgSyncReply frame.
func (h *sheetsDocHandle) EncodeStateAsUpdate() ([]byte, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed || h.doc == nil {
		return nil, fmt.Errorf("calc: EncodeStateAsUpdate on closed room %s", h.id)
	}
	return ycrdt.EncodeStateAsUpdate(h.doc, nil), nil
}

// Close releases the room's Y.Doc so it can be garbage-collected.
func (h *sheetsDocHandle) Close() error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return nil
	}
	h.closed = true
	h.doc = nil
	h.runtime.closeDoc(h.id)
	return nil
}

// Snapshot returns a Go-native, point-in-time view of the room's
// Y.Doc. The serializer in persist.go consumes this; nothing in this
// path crosses the realtime wire.
func (h *sheetsDocHandle) Snapshot() (YDocSnapshot, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed || h.doc == nil {
		return YDocSnapshot{}, fmt.Errorf("calc: Snapshot on closed room %s", h.id)
	}

	sheetsRaw := h.doc.GetMap("sheets")
	cellsRaw := h.doc.GetMap("cells")
	pivotsRaw := h.doc.GetMap("pivots")
	sheetsMap, _ := sheetsRaw.(*ycrdt.YMap)
	cellsMap, _ := cellsRaw.(*ycrdt.YMap)
	pivotsMap, _ := pivotsRaw.(*ycrdt.YMap)

	snap := YDocSnapshot{}
	if sheetsMap != nil {
		sheets, err := collectSheets(sheetsMap)
		if err != nil {
			return YDocSnapshot{}, err
		}
		snap.Sheets = sheets
	}
	if cellsMap != nil {
		cells, err := collectCells(cellsMap)
		if err != nil {
			return YDocSnapshot{}, err
		}
		snap.Cells = cells
	}
	if pivotsMap != nil {
		snap.Pivots = collectPivots(pivotsMap)
	}
	return snap, nil
}

// collectSheets walks the top-level "sheets" YMap and returns sheet
// metadata sorted by position. Each value should itself be a YMap
// holding name/position/rowCount/colCount and optionally the sparse
// rowHeights/colWidths/rowStyles maps (decoded inline below).
// Non-YMap values are skipped — they would indicate a schema violation
// but we'd rather ship a partial snapshot than fail the whole save.
// Style-decode failures bubble up as errors so the save can retry
// rather than silently persist a partial snapshot.
func collectSheets(sheetsMap *ycrdt.YMap) ([]SheetMeta, error) {
	out := make([]SheetMeta, 0, sheetsMap.GetSize())
	var collectErr error
	sheetsMap.ForEach(func(sheetID string, value any, _ *ycrdt.YMap) {
		if collectErr != nil {
			return
		}
		meta, ok := value.(*ycrdt.YMap)
		if !ok {
			return
		}
		name, _ := meta.Get("name").(string)
		if name == "" {
			name = sheetID
		}
		rowStyles, err := decodeSparseStyleMap(meta, "rowStyles")
		if err != nil {
			collectErr = err
			return
		}
		color, _ := meta.Get("color").(string)
		hidden, _ := meta.Get("hidden").(bool)
		cfRules, err := decodeConditionalFormats(meta, "conditionalFormats")
		if err != nil {
			collectErr = err
			return
		}
		out = append(out, SheetMeta{
			ID:                 sheetID,
			Name:               name,
			Position:           numberFromAny(meta.Get("position")),
			RowCount:           numberFromAny(meta.Get("rowCount")),
			ColCount:           numberFromAny(meta.Get("colCount")),
			RowHeights:         decodeSparseIntMap(meta, "rowHeights"),
			ColWidths:          decodeSparseIntMap(meta, "colWidths"),
			RowStyles:          rowStyles,
			Color:              color,
			Hidden:             hidden,
			Merges:             decodeMerges(meta, "merges"),
			FrozenRows:         numberFromAny(meta.Get("frozenRows")),
			FrozenCols:         numberFromAny(meta.Get("frozenCols")),
			ConditionalFormats: cfRules,
		})
	})
	if collectErr != nil {
		return nil, collectErr
	}
	// Stable sort by position (slice index is what the serializer
	// uses to align with existing-sheet positions on disk).
	sortSheetsByPosition(out)
	return out, nil
}

// collectCells walks the top-level "cells" YMap. Keys are
// "<sheetID>:<row>:<col>" strings produced by yCellKey.ts; values are
// per-cell YMaps holding kind/raw/display/formula/style.
func collectCells(cellsMap *ycrdt.YMap) ([]CellEntry, error) {
	out := make([]CellEntry, 0, cellsMap.GetSize())
	var collectErr error
	cellsMap.ForEach(func(key string, value any, _ *ycrdt.YMap) {
		if collectErr != nil {
			return
		}
		cellMap, ok := value.(*ycrdt.YMap)
		if !ok {
			return
		}
		sheetID, row, col, ok := parseCellKey(key)
		if !ok {
			return
		}
		entry := CellEntry{
			SheetID: sheetID,
			Row:     row,
			Col:     col,
		}
		if k, ok := cellMap.Get("kind").(string); ok {
			entry.Kind = k
		}
		switch raw := cellMap.Get("raw").(type) {
		case string:
			entry.RawString = raw
		case float64:
			n := raw
			entry.RawNumber = &n
		case float32:
			n := float64(raw)
			entry.RawNumber = &n
		case int:
			n := float64(raw)
			entry.RawNumber = &n
		case int32:
			n := float64(raw)
			entry.RawNumber = &n
		case int64:
			n := float64(raw)
			entry.RawNumber = &n
		case bool:
			b := raw
			entry.RawBool = &b
		}
		if d, ok := cellMap.Get("display").(string); ok {
			entry.Display = d
		}
		if f, ok := cellMap.Get("formula").(string); ok {
			entry.Formula = f
		}
		if styleVal := cellMap.Get("style"); styleVal != nil {
			if styleMap, ok := styleVal.(*ycrdt.YMap); ok {
				cs, err := decodeCellStyle(styleMap)
				if err != nil {
					collectErr = fmt.Errorf("decode style for %s!%d:%d: %w", sheetID, row, col, err)
					return
				}
				entry.Style = cs
			}
		}
		out = append(out, entry)
	})
	if collectErr != nil {
		return nil, collectErr
	}
	return out, nil
}

// collectPivots walks the top-level "pivots" YMap and returns the
// pivot definitions in the doc. Map key is the pivot ID; value is a
// YMap mirroring the write shape in tinycld/calc/lib/pivot/y-binding.ts
// (sourceRange/targetSheetName scalars; rows/cols/values/filters
// Y.Arrays; filterSelections nested Y.Map of Y.Arrays; per-flag bools;
// optional styleName scalar).
//
// Malformed entries (non-YMap values, missing required fields, etc.)
// are skipped silently — a partial snapshot is better than a failed
// save. The order entries appear in is iteration order on the YMap,
// which is stable per-doc but not user-meaningful; callers that need
// deterministic ordering should sort downstream.
func collectPivots(pivotsMap *ycrdt.YMap) []PivotDefinitionDTO {
	if pivotsMap.GetSize() == 0 {
		return nil
	}
	out := make([]PivotDefinitionDTO, 0, pivotsMap.GetSize())
	pivotsMap.ForEach(func(id string, value any, _ *ycrdt.YMap) {
		entry, ok := value.(*ycrdt.YMap)
		if !ok {
			return
		}
		dto := PivotDefinitionDTO{
			ID:               id,
			SourceRange:      stringFromAny(entry.Get("sourceRange")),
			TargetSheetName:  stringFromAny(entry.Get("targetSheetName")),
			Rows:             decodePivotFields(entry, "rows"),
			Cols:             decodePivotFields(entry, "cols"),
			Values:           decodePivotValueFields(entry, "values"),
			Filters:          decodePivotFields(entry, "filters"),
			FilterSelections: decodeFilterSelections(entry, "filterSelections"),
			RowGrandTotals:   boolFromAny(entry.Get("rowGrandTotals")),
			ColGrandTotals:   boolFromAny(entry.Get("colGrandTotals")),
			RowSubtotals:     boolFromAny(entry.Get("rowSubtotals")),
			ColSubtotals:     boolFromAny(entry.Get("colSubtotals")),
			StyleName:        stringFromAny(entry.Get("styleName")),
		}
		out = append(out, dto)
	})
	if len(out) == 0 {
		return nil
	}
	return out
}

// decodePivotFields reads a Y.Array of Y.Maps (rows/cols/filters) and
// returns the per-field DTOs. Missing array or non-Array value yields
// nil; non-Map elements within the array are skipped.
func decodePivotFields(parent *ycrdt.YMap, key string) []PivotFieldDTO {
	arr, ok := parent.Get(key).(*ycrdt.YArray)
	if !ok || arr.GetLength() == 0 {
		return nil
	}
	out := make([]PivotFieldDTO, 0, arr.GetLength())
	arr.ForEach(func(item any, _ ycrdt.Number, _ ycrdt.IAbstractType) {
		m, ok := item.(*ycrdt.YMap)
		if !ok {
			return
		}
		out = append(out, PivotFieldDTO{
			SourceColumn: stringFromAny(m.Get("sourceColumn")),
			DisplayName:  stringFromAny(m.Get("displayName")),
		})
	})
	if len(out) == 0 {
		return nil
	}
	return out
}

// decodePivotValueFields reads the "values" Y.Array of Y.Maps and
// returns the per-value DTOs. Aggregation falls back to "sum" on
// missing or unrecognized inputs (the validation lives downstream in
// excelizeSubtotal). NumFmt is carried through verbatim — see
// PivotValueFieldDTO docstring for why the export path then drops it.
func decodePivotValueFields(parent *ycrdt.YMap, key string) []PivotValueFieldDTO {
	arr, ok := parent.Get(key).(*ycrdt.YArray)
	if !ok || arr.GetLength() == 0 {
		return nil
	}
	out := make([]PivotValueFieldDTO, 0, arr.GetLength())
	arr.ForEach(func(item any, _ ycrdt.Number, _ ycrdt.IAbstractType) {
		m, ok := item.(*ycrdt.YMap)
		if !ok {
			return
		}
		out = append(out, PivotValueFieldDTO{
			SourceColumn: stringFromAny(m.Get("sourceColumn")),
			DisplayName:  stringFromAny(m.Get("displayName")),
			Aggregation:  stringFromAny(m.Get("aggregation")),
			NumFmt:       stringFromAny(m.Get("numFmt")),
		})
	})
	if len(out) == 0 {
		return nil
	}
	return out
}

// decodeFilterSelections reads the nested filterSelections Y.Map (one
// Y.Array of string per column) and returns the equivalent Go map.
// Returns nil for absent or empty maps so the DTO's omitempty tag
// drops it on the wire.
func decodeFilterSelections(parent *ycrdt.YMap, key string) map[string][]string {
	nested, ok := parent.Get(key).(*ycrdt.YMap)
	if !ok || nested.GetSize() == 0 {
		return nil
	}
	out := map[string][]string{}
	nested.ForEach(func(col string, value any, _ *ycrdt.YMap) {
		arr, ok := value.(*ycrdt.YArray)
		if !ok || arr.GetLength() == 0 {
			return
		}
		vals := make([]string, 0, arr.GetLength())
		arr.ForEach(func(item any, _ ycrdt.Number, _ ycrdt.IAbstractType) {
			if s, ok := item.(string); ok {
				vals = append(vals, s)
			}
		})
		if len(vals) > 0 {
			out[col] = vals
		}
	})
	if len(out) == 0 {
		return nil
	}
	return out
}

// stringFromAny extracts a string scalar from a y-crdt-decoded value;
// non-string inputs return "".
func stringFromAny(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

// boolFromAny extracts a bool scalar from a y-crdt-decoded value;
// non-bool inputs return false.
func boolFromAny(v any) bool {
	if b, ok := v.(bool); ok {
		return b
	}
	return false
}

// decodeCellStyle converts a style YMap (groups → leaves, mirroring
// the TS CellStyle shape) into *CellStyle. Returns nil when the style
// is structurally empty so callers can leave the cell's existing
// on-disk style alone.
//
// We flatten the YMap into a plain map and round-trip through
// json.Marshal+Unmarshal so the existing CellStyle json tags drive
// the camelCase ↔ PascalCase translation. This keeps "add a
// structurally-trivial attribute" a one-line edit on the TS+Go types
// and zero changes here.
func decodeCellStyle(styleMap *ycrdt.YMap) (*CellStyle, error) {
	flat := flattenStyleMap(styleMap)
	if len(flat) == 0 {
		return nil, nil
	}
	coerceNumericStringLeaves(flat)
	buf, err := json.Marshal(flat)
	if err != nil {
		return nil, err
	}
	var cs CellStyle
	if err := json.Unmarshal(buf, &cs); err != nil {
		return nil, err
	}
	return &cs, nil
}

// coerceNumericStringLeaves walks the flattened style map and parses
// any string leaf whose corresponding CellStyle field is *float64 (or
// any numeric type) back into a number. This compensates for
// emitStyleYMap's normalizeRawForY step: y-crdt's Go TypeMapSet
// rejects float64, so fractional font sizes (and any future float
// leaf) get serialized as a numeric string. Without this coercion,
// json.Unmarshal would fail to decode "13.5" into *float64.
//
// Integer-valued floats land as int in the YMap (per normalizeRawForY)
// and JSON already coerces int→float64 transparently — no work needed
// for that case.
func coerceNumericStringLeaves(flat map[string]any) {
	csType := reflect.TypeOf(CellStyle{})
	for groupKey, value := range flat {
		groupField, ok := fieldByJSONTag(csType, groupKey)
		if !ok {
			continue
		}
		nested, ok := value.(map[string]any)
		if !ok {
			// Scalar group (e.g. numFmt is *string at the top level).
			coerceLeafToFieldType(flat, groupKey, groupField.Type)
			continue
		}
		// Group struct fields are *Struct → recurse one level.
		groupType := groupField.Type
		if groupType.Kind() == reflect.Pointer {
			groupType = groupType.Elem()
		}
		if groupType.Kind() != reflect.Struct {
			continue
		}
		for leafKey := range nested {
			leafField, ok := fieldByJSONTag(groupType, leafKey)
			if !ok {
				continue
			}
			coerceLeafToFieldType(nested, leafKey, leafField.Type)
		}
	}
}

func coerceLeafToFieldType(host map[string]any, key string, fieldType reflect.Type) {
	if fieldType.Kind() == reflect.Pointer {
		fieldType = fieldType.Elem()
	}
	switch fieldType.Kind() {
	case reflect.Float32, reflect.Float64:
		if s, ok := host[key].(string); ok {
			if n, err := strconv.ParseFloat(s, 64); err == nil {
				host[key] = n
			}
		}
	}
}

func fieldByJSONTag(t reflect.Type, tag string) (reflect.StructField, bool) {
	if t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	if t.Kind() != reflect.Struct {
		return reflect.StructField{}, false
	}
	for i := 0; i < t.NumField(); i++ {
		f := t.Field(i)
		if jsonFieldKey(f) == tag {
			return f, true
		}
	}
	return reflect.StructField{}, false
}

// flattenStyleMap walks the style YMap tree and returns a plain map
// suitable for json.Marshal. Handles three nesting levels:
//   - top-level scalar leaves (numFmt)
//   - group YMaps with scalar leaves (font.bold, alignment.horizontal)
//   - group YMaps with nested YMap leaves (borders.top = {style, color})
//
// json.Marshal would otherwise choke on a YMap pointer it doesn't
// recognize, leaving the per-edge color/style data unrecoverable.
// Nil / missing values are skipped at every level so the resulting
// object only carries explicitly-set attributes.
func flattenStyleMap(styleMap *ycrdt.YMap) map[string]any {
	out := map[string]any{}
	styleMap.ForEach(func(key string, value any, _ *ycrdt.YMap) {
		if value == nil {
			return
		}
		if group, ok := value.(*ycrdt.YMap); ok {
			leaves := map[string]any{}
			group.ForEach(func(k string, v any, _ *ycrdt.YMap) {
				if v == nil {
					return
				}
				if inner, ok := v.(*ycrdt.YMap); ok {
					nested := map[string]any{}
					inner.ForEach(func(ik string, iv any, _ *ycrdt.YMap) {
						if iv == nil {
							return
						}
						nested[ik] = iv
					})
					if len(nested) > 0 {
						leaves[k] = nested
					}
					return
				}
				leaves[k] = v
			})
			if len(leaves) > 0 {
				out[key] = leaves
			}
			return
		}
		out[key] = value
	})
	return out
}

// numberFromAny coerces a y-crdt-decoded number value to int. y-crdt
// decodes JS numbers as float64; older payloads may carry int.
func numberFromAny(v any) int {
	switch n := v.(type) {
	case int:
		return n
	case int32:
		return int(n)
	case int64:
		return int(n)
	case float32:
		return int(n)
	case float64:
		return int(n)
	}
	return 0
}

// decodeSparseIntMap pulls a nested Y.Map<string,int-like> off the
// given parent meta map and returns it as a Go map[int]int. Keys that
// fail to parse as a positive integer are skipped.
//
// Tri-state return — load-bearing for the serializer's clear-then-
// write contract:
//   - nil: the Y.Doc has no nested map for this key at all (sheet was
//     bootstrapped before this field was tracked, or never had a
//     customization). The serializer leaves the on-disk xlsx alone.
//   - non-nil empty: the Y.Doc has the nested map but every entry has
//     been removed (user cleared all customizations). The serializer
//     unsets all on-disk customizations for this field.
//   - non-nil non-empty: the entries are authoritative. The serializer
//     unsets any on-disk entry not in the map and writes the rest.
//
// Without the empty-but-non-nil case, a clear-the-last-entry would
// silently bounce back on reload because the decoder collapsed
// "absent" and "empty" both to nil.
func decodeSparseIntMap(meta *ycrdt.YMap, key string) map[int]int {
	nested, ok := meta.Get(key).(*ycrdt.YMap)
	if !ok {
		return nil
	}
	out := map[int]int{}
	nested.ForEach(func(k string, v any, _ *ycrdt.YMap) {
		n, err := strconv.Atoi(k)
		if err != nil || n < 1 {
			return
		}
		out[n] = numberFromAny(v)
	})
	return out
}

// decodeMerges pulls the nested merges Y.Map off the sheet meta and
// returns the rectangles. Keys are "row:col" anchor coords; each value
// is a small YMap with rowSpan and colSpan integer fields. Skips
// malformed entries silently — a partial snapshot beats a failed save.
func decodeMerges(meta *ycrdt.YMap, key string) []MergeRange {
	nested, ok := meta.Get(key).(*ycrdt.YMap)
	if !ok || nested.GetSize() == 0 {
		return nil
	}
	out := make([]MergeRange, 0, nested.GetSize())
	nested.ForEach(func(k string, v any, _ *ycrdt.YMap) {
		parts := strings.SplitN(k, ":", 2)
		if len(parts) != 2 {
			return
		}
		row, err := strconv.Atoi(parts[0])
		if err != nil || row < 1 {
			return
		}
		col, err := strconv.Atoi(parts[1])
		if err != nil || col < 1 {
			return
		}
		entry, ok := v.(*ycrdt.YMap)
		if !ok {
			return
		}
		rowSpan := numberFromAny(entry.Get("rowSpan"))
		colSpan := numberFromAny(entry.Get("colSpan"))
		if rowSpan < 1 || colSpan < 1 {
			return
		}
		if rowSpan == 1 && colSpan == 1 {
			return
		}
		out = append(out, MergeRange{
			AnchorRow: row,
			AnchorCol: col,
			RowSpan:   rowSpan,
			ColSpan:   colSpan,
		})
	})
	if len(out) == 0 {
		return nil
	}
	return out
}

// decodeConditionalFormats reads the per-sheet conditionalFormats
// Y.Array (rules in priority order) and returns the corresponding
// snapshot DTOs. Shape mirrors the TS y-binding writeRule output.
// Malformed entries are skipped silently so a partial corruption
// doesn't tank an otherwise-valid save.
func decodeConditionalFormats(meta *ycrdt.YMap, key string) ([]ConditionalFormatRule, error) {
	arr, ok := meta.Get(key).(*ycrdt.YArray)
	if !ok || arr.GetLength() == 0 {
		return nil, nil
	}
	out := make([]ConditionalFormatRule, 0, arr.GetLength())
	var collectErr error
	arr.ForEach(func(item any, _ ycrdt.Number, _ ycrdt.IAbstractType) {
		if collectErr != nil {
			return
		}
		m, ok := item.(*ycrdt.YMap)
		if !ok {
			return
		}
		id := stringFromAny(m.Get("id"))
		if id == "" {
			return
		}
		ranges := decodeStringArray(m, "ranges")
		condRaw, ok := m.Get("condition").(*ycrdt.YMap)
		if !ok {
			return
		}
		cond := ConditionalCondition{Type: stringFromAny(condRaw.Get("type"))}
		if cond.Type == "" {
			return
		}
		if v1 := stringFromAny(condRaw.Get("value1")); v1 != "" {
			cond.Value1 = &v1
		}
		if v2 := stringFromAny(condRaw.Get("value2")); v2 != "" {
			cond.Value2 = &v2
		}
		if formula := stringFromAny(condRaw.Get("formula")); formula != "" {
			cond.Formula = &formula
		}
		if opaqueMap, ok := condRaw.Get("opaqueXlsx").(*ycrdt.YMap); ok && opaqueMap.GetSize() > 0 {
			blob := map[string]interface{}{}
			opaqueMap.ForEach(func(k string, v any, _ *ycrdt.YMap) {
				blob[k] = v
			})
			cond.OpaqueXlsx = blob
		}
		rule := ConditionalFormatRule{
			ID:        id,
			Ranges:    ranges,
			Condition: cond,
		}
		if styleMap, ok := m.Get("style").(*ycrdt.YMap); ok {
			cs, err := decodeCellStyle(styleMap)
			if err != nil {
				collectErr = fmt.Errorf("decode CF rule %s style: %w", id, err)
				return
			}
			rule.Style = cs
		}
		out = append(out, rule)
	})
	if collectErr != nil {
		return nil, collectErr
	}
	if len(out) == 0 {
		return nil, nil
	}
	return out, nil
}

// decodeStringArray walks a Y.Array<string> off a parent meta map
// and returns the contained string values, skipping non-string
// entries silently. Returns nil for absent or empty arrays.
func decodeStringArray(parent *ycrdt.YMap, key string) []string {
	arr, ok := parent.Get(key).(*ycrdt.YArray)
	if !ok || arr.GetLength() == 0 {
		return nil
	}
	out := make([]string, 0, arr.GetLength())
	arr.ForEach(func(item any, _ ycrdt.Number, _ ycrdt.IAbstractType) {
		if s, ok := item.(string); ok && s != "" {
			out = append(out, s)
		}
	})
	if len(out) == 0 {
		return nil
	}
	return out
}

// decodeSparseStyleMap pulls a nested Y.Map<string, Y.Map> off the
// given parent meta map and returns it as a map[int]*CellStyle.
// Decodes each entry through decodeCellStyle to keep the shape
// identical to per-cell styles.
//
// Tri-state return — same contract as decodeSparseIntMap. See that
// function's docstring for the absent / empty / non-empty meanings.
func decodeSparseStyleMap(meta *ycrdt.YMap, key string) (map[int]*CellStyle, error) {
	nested, ok := meta.Get(key).(*ycrdt.YMap)
	if !ok {
		return nil, nil
	}
	out := map[int]*CellStyle{}
	var decodeErr error
	nested.ForEach(func(k string, v any, _ *ycrdt.YMap) {
		if decodeErr != nil {
			return
		}
		n, err := strconv.Atoi(k)
		if err != nil || n < 1 {
			return
		}
		styleMap, ok := v.(*ycrdt.YMap)
		if !ok {
			return
		}
		cs, err := decodeCellStyle(styleMap)
		if err != nil {
			decodeErr = fmt.Errorf("decode row style %d: %w", n, err)
			return
		}
		if cs != nil {
			out[n] = cs
		}
	})
	if decodeErr != nil {
		return nil, decodeErr
	}
	return out, nil
}

// parseCellKey splits "<sheetID>:<row>:<col>" into its three parts.
// Returns ok=false for any malformed key (the snapshot just skips it).
// SheetIDs in production never contain colons (they're "sheet1",
// "sheet2", …) so a 3-way split is unambiguous.
func parseCellKey(key string) (string, int, int, bool) {
	parts := strings.SplitN(key, ":", 3)
	if len(parts) != 3 {
		return "", 0, 0, false
	}
	row, err := strconv.Atoi(parts[1])
	if err != nil {
		return "", 0, 0, false
	}
	col, err := strconv.Atoi(parts[2])
	if err != nil {
		return "", 0, 0, false
	}
	return parts[0], row, col, true
}

// sortSheetsByPosition is an insertion sort over a small slice (sheet
// counts are typically 1-3). Avoids dragging in sort.Slice for one
// call site.
func sortSheetsByPosition(s []SheetMeta) {
	for i := 1; i < len(s); i++ {
		j := i
		for j > 0 && s[j-1].Position > s[j].Position {
			s[j-1], s[j] = s[j], s[j-1]
			j--
		}
	}
}
