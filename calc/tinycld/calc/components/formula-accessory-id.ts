// Shared nativeID for the iOS InputAccessoryView mounted at the Grid
// level. Both the FormulaBar and the in-cell editor TextInputs
// reference this id via `inputAccessoryViewID`, so the same accessory
// bar follows whichever surface is being edited. Lives in its own
// module to avoid a Grid <-> FormulaBar circular import (Grid.tsx
// already imports from FormulaBar.tsx).
export const FORMULA_BAR_ACCESSORY_ID = 'calc-formula-bar-accessory'
