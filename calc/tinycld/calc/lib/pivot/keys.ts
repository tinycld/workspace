// PIVOTS_MAP is the top-level Y.Map name holding pivot definitions,
// keyed by PivotDefinition.id. Each value is a Y.Map mirroring the
// PivotDefinition shape (scalars as keys; rows/cols/values/filters as
// Y.Arrays of Y.Maps; filterSelections as a nested Y.Map of Y.Arrays).
export const PIVOTS_MAP = 'pivots'

// PIVOT_SHEET_KEY is the per-sheet meta key that, when set, marks
// the sheet as a pivot's dedicated output sheet. Value is the
// PivotDefinition.id this sheet belongs to. Grid.tsx branches on
// this to render engine output instead of the cells Y.Map.
export const PIVOT_SHEET_KEY = 'pivotId'
