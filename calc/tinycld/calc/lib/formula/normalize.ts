import type { CellValue, DetailedCellError, RawCellContent } from 'hyperformula'
import type { CellRaw } from '../workbook-types'
import type { YCellValue } from '../y-doc-bootstrap'

// hfInputForCell converts a Y.Doc cell snapshot into the value
// HyperFormula expects via setCellContents:
//
//   - formula cells -> the formula text ('=SUM(A1:A2)') so HF parses
//     and tracks dependencies
//   - number/string/boolean -> the raw scalar
//   - date -> the ISO string (HF parses it as text; date semantics
//     can be wired later via HF's date config)
//
// Cells with no kind / unknown kind fall back to the raw value or
// null, leaving HF to treat them as empty.
export function hfInputForCell(cell: YCellValue | null): RawCellContent {
    if (cell == null) return null
    if (cell.kind === 'formula') {
        return cell.formula ?? null
    }
    if (cell.raw == null) return null
    return cell.raw
}

// normalizeHfValue converts a HyperFormula cell value (the type of
// ExportedCellChange.newValue) into our CellRaw shape.
//
//   - number/string/boolean -> pass through
//   - DetailedCellError (#DIV/0!, #REF!, #NAME?, etc.) -> the .value
//     string. formatCell renders string raws on formula cells directly,
//     so the error text appears in the grid
//   - null/undefined -> null
//
// HF's date semantics aren't enabled in the PoC, so number values that
// represent dates would arrive as raw numbers. That's fine: SUM of
// numbers is what users expect from the SUM/AVG PoC.
export function normalizeHfValue(value: CellValue | undefined): CellRaw {
    if (value == null) return null
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    if (typeof value === 'string') return value
    if (typeof value === 'boolean') return value
    // DetailedCellError instance — surface its display string. Use
    // duck-typing on .value rather than instanceof so we don't have to
    // import the class just to narrow the type.
    if (typeof (value as DetailedCellError).value === 'string') {
        return (value as DetailedCellError).value
    }
    return null
}
