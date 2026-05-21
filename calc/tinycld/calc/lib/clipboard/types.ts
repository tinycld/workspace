// Clipboard payload shape — the fidelity-preserving form for copy/paste.
//
// A ClipboardPayload is what serializeRange produces from a CellRange and
// what applyPayloadToDoc consumes. It's also what's stashed in the module-
// level fidelity store (lib/clipboard/store.ts) so a same-process paste
// can recover full kind/raw/formula/style even when the OS clipboard
// dropped everything except text/html.
//
// `cells` is row-major, length === rows, each inner array length === cols.
// Empty source cells are encoded as `{ kind: 'string', raw: '' }` rather
// than null so the shape is rectangular — the deserializer relies on
// indices into a dense 2D grid for formula-delta math and transpose.
//
// `sourceAnchor` is the 1-based (row, col) of the source range's top-left.
// The deserializer subtracts this from the paste destAnchor to compute
// (deltaRow, deltaCol) for the formula rewriter.

import type { CellKind, CellRaw, CellStyle } from '../workbook-types'

export interface ClipboardCell {
    kind: CellKind
    raw: CellRaw
    formula?: string
    style?: CellStyle
}

// MergedCellRange in a clipboard payload uses *relative* offsets from
// the source range's top-left (0,0). The deserializer adds the
// destination anchor to relocate each merge at the paste site.
export interface ClipboardMerge {
    rowOffset: number
    colOffset: number
    rowSpan: number
    colSpan: number
}

export interface ClipboardPayload {
    rows: number
    cols: number
    cells: ClipboardCell[][]
    sourceAnchor: { row: number; col: number }
    merges?: ClipboardMerge[]
}

// PasteMode selects which subset of a copied cell is written to the dest.
//   'all'       — write kind/raw/formula + style. Formulas rewrite refs.
//   'values'    — write only kind/raw (skip formula, skip style). For
//                 formula cells in the source, the cached result `raw`
//                 is what lands at the destination — matching Sheets'
//                 "Paste values only" semantics.
//   'formulas'  — write kind/raw/formula but skip style. Rewrite refs.
//   'format'    — write only style (deep-merged via setYCellStyle). Does
//                 not touch kind/raw/formula on the destination cell.
//   'transpose' — same as 'all' but row/col swapped on dest. The formula
//                 rewriter still applies the (dest - source) delta on the
//                 transposed indices.
export type PasteMode = 'all' | 'values' | 'formulas' | 'format' | 'transpose'

export interface PasteOptions {
    mode: PasteMode
    destAnchor: { row: number; col: number }
}
