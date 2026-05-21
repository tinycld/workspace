// Sheet rename / delete propagation for pivot definitions. Lives in
// lib/pivot/ rather than inside use-sheet-actions because the rewrite
// rules (range parsing, quoted sheet names) belong with the rest of
// the pivot data model.

import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import * as Y from 'yjs'
import {
    PIVOT_SHEET_KEY,
    PIVOTS_MAP,
    SHEETS_MAP,
} from '../y-doc-bootstrap'
import { buildA1Range, parseA1Range } from './range-parse'
import { deletePivot } from './y-binding'

// Rewrites every pivot def in the doc so that any reference to
// `oldName` (as the source-range sheet OR the target sheet) becomes
// `newName`. Sheets that don't reference the renamed sheet are left
// untouched. Quoted/unquoted rendering of the new name is handled by
// buildA1Range. Pivots whose sourceRange fails to parse stay as-is —
// the engine surfaces a parse error to the user.
export function propagateSheetRename(
    doc: Y.Doc,
    oldName: string,
    newName: string
): void {
    if (oldName === newName) return
    const pivots = doc.getMap<Y.Map<unknown>>(PIVOTS_MAP)
    doc.transact(() => {
        pivots.forEach(entry => {
            if (!(entry instanceof Y.Map)) return
            const sourceRange = entry.get('sourceRange')
            if (typeof sourceRange === 'string') {
                const parsed = parseA1Range(sourceRange)
                if (parsed.ok && parsed.sheetName === oldName) {
                    entry.set(
                        'sourceRange',
                        buildA1Range(
                            newName,
                            parsed.startRow,
                            parsed.startCol,
                            parsed.endRow,
                            parsed.endCol
                        )
                    )
                }
            }
            const target = entry.get('targetSheetName')
            if (typeof target === 'string' && target === oldName) {
                entry.set('targetSheetName', newName)
            }
        })
    }, LOCAL_ORIGIN)
}

// Drops the pivot def whose target is the deleted sheet (i.e. the
// sheet whose meta carries PIVOT_SHEET_KEY). Deleting a source-only
// sheet is intentionally NOT propagated here: the def stays so the
// user can edit `sourceRange` to recover; the engine surfaces a
// missing-source-sheet error in the meantime.
export function propagateSheetDelete(doc: Y.Doc, sheetId: string): void {
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const meta = sheetsMap.get(sheetId)
    if (!(meta instanceof Y.Map)) return
    const pivotId = meta.get(PIVOT_SHEET_KEY)
    if (typeof pivotId !== 'string') return
    deletePivot(doc, pivotId)
}
