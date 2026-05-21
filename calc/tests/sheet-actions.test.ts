import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { buildSheetActions } from '../tinycld/calc/hooks/use-sheet-actions'
import { setYColWidth } from '../tinycld/calc/lib/dimensions'
import { setYCell } from '../tinycld/calc/hooks/use-y-cell'
import { yCellKey } from '../tinycld/calc/lib/y-cell-key'
import {
    CELLS_MAP,
    SHEET_COLOR_KEY,
    SHEET_HIDDEN_KEY,
    SHEETS_MAP,
    ydocSheetIds,
} from '../tinycld/calc/lib/y-doc-bootstrap'

// Tests use buildSheetActions (the pure factory) rather than the React
// hook so they can run in vitest without a renderer. Same code path the
// hook returns from useMemo.

function bootstrapBlank(): Y.Doc {
    const doc = new Y.Doc()
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const meta = new Y.Map<unknown>()
    meta.set('name', 'Sheet 1')
    meta.set('position', 0)
    meta.set('rowCount', 0)
    meta.set('colCount', 0)
    sheetsMap.set('sheet1', meta)
    return doc
}

describe('useSheetActions: addSheet', () => {
    it('creates sheet with sequential id and default name pattern', () => {
        const doc = bootstrapBlank()
        const actions = buildSheetActions(doc)
        const id1 = actions.addSheet()
        expect(id1).toBe('sheet2')
        expect(ydocSheetIds(doc)).toEqual(['sheet1', 'sheet2'])
        const sheets = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
        expect(sheets.get(id1)?.get('name')).toBe('Sheet 2')
        expect(sheets.get(id1)?.get('position')).toBe(1)

        const id2 = actions.addSheet()
        expect(id2).toBe('sheet3')
        expect(sheets.get(id2)?.get('name')).toBe('Sheet 3')
    })

    it('numbers default name from highest existing Sheet N across visible + hidden', () => {
        const doc = bootstrapBlank()
        const actions = buildSheetActions(doc)
        // Rename sheet1 to "Sheet 5", then add — next default should be 6.
        actions.renameSheet('sheet1', 'Sheet 5')
        const id = actions.addSheet()
        const sheets = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
        expect(sheets.get(id)?.get('name')).toBe('Sheet 6')
    })

    it('addSheet with explicit name uses it; falls back if duplicate', () => {
        const doc = bootstrapBlank()
        const actions = buildSheetActions(doc)
        const id = actions.addSheet('Custom')
        const sheets = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
        expect(sheets.get(id)?.get('name')).toBe('Custom')
        // Adding "Custom" again — second add should disambiguate so the
        // call still succeeds; uniqueness is the rename-side guarantee.
        const id2 = actions.addSheet('Custom')
        const name = sheets.get(id2)?.get('name') as string
        expect(name).not.toBe('Custom')
        expect(name.startsWith('Custom')).toBe(true)
    })
})

describe('useSheetActions: renameSheet', () => {
    it('renames to a unique non-empty name', () => {
        const doc = bootstrapBlank()
        const actions = buildSheetActions(doc)
        const result = actions.renameSheet('sheet1', 'Renamed')
        expect(result).toEqual({ ok: true })
        const sheets = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
        expect(sheets.get('sheet1')?.get('name')).toBe('Renamed')
    })

    it('rejects empty name', () => {
        const doc = bootstrapBlank()
        const actions = buildSheetActions(doc)
        const result = actions.renameSheet('sheet1', '   ')
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error.toLowerCase()).toContain('empty')
    })

    it('rejects duplicate name (against another sheet)', () => {
        const doc = bootstrapBlank()
        const actions = buildSheetActions(doc)
        actions.addSheet('Other')
        const result = actions.renameSheet('sheet1', 'Other')
        expect(result.ok).toBe(false)
        if (!result.ok) expect(result.error.toLowerCase()).toContain('already')
    })

    it('allows renaming to the same name (no-op)', () => {
        const doc = bootstrapBlank()
        const actions = buildSheetActions(doc)
        const result = actions.renameSheet('sheet1', 'Sheet 1')
        expect(result).toEqual({ ok: true })
    })

    it('trims whitespace before validation', () => {
        const doc = bootstrapBlank()
        const actions = buildSheetActions(doc)
        const result = actions.renameSheet('sheet1', '  Trimmed  ')
        expect(result).toEqual({ ok: true })
        const sheets = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
        expect(sheets.get('sheet1')?.get('name')).toBe('Trimmed')
    })
})

describe('useSheetActions: deleteSheet', () => {
    it('removes the sheet from sheets Y.Map', () => {
        const doc = bootstrapBlank()
        const actions = buildSheetActions(doc)
        actions.addSheet()
        actions.deleteSheet('sheet1')
        expect(ydocSheetIds(doc)).toEqual(['sheet2'])
    })

    it('removes every cell whose key starts with the sheet id', () => {
        const doc = bootstrapBlank()
        const actions = buildSheetActions(doc)
        actions.addSheet()
        // Seed cells on both sheets.
        setYCell(doc, 'sheet1', 1, 1, 'a')
        setYCell(doc, 'sheet1', 2, 2, 'b')
        setYCell(doc, 'sheet2', 1, 1, 'c')
        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        expect(cellsMap.has(yCellKey('sheet1', 1, 1))).toBe(true)
        actions.deleteSheet('sheet1')
        expect(cellsMap.has(yCellKey('sheet1', 1, 1))).toBe(false)
        expect(cellsMap.has(yCellKey('sheet1', 2, 2))).toBe(false)
        expect(cellsMap.has(yCellKey('sheet2', 1, 1))).toBe(true)
    })

    it('compacts positions after a delete (no gaps)', () => {
        const doc = bootstrapBlank()
        const actions = buildSheetActions(doc)
        actions.addSheet() // sheet2 pos=1
        actions.addSheet() // sheet3 pos=2
        actions.deleteSheet('sheet2')
        const sheets = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
        expect(sheets.get('sheet1')?.get('position')).toBe(0)
        expect(sheets.get('sheet3')?.get('position')).toBe(1)
    })
})

describe('useSheetActions: duplicateSheet', () => {
    it('clones cells and dims; new sheet gets a fresh id and is independent', () => {
        const doc = bootstrapBlank()
        const actions = buildSheetActions(doc)
        setYCell(doc, 'sheet1', 1, 1, 'A')
        setYCell(doc, 'sheet1', 2, 1, 'B')
        setYColWidth(doc, 'sheet1', 1, 200)

        const newId = actions.duplicateSheet('sheet1')
        expect(newId).toBe('sheet2')

        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        const cellOriginal = cellsMap.get(yCellKey('sheet1', 1, 1))
        const cellCopy = cellsMap.get(yCellKey(newId, 1, 1))
        expect(cellCopy).not.toBe(cellOriginal)
        expect((cellCopy as Y.Map<unknown>).get('raw')).toBe('A')
        expect((cellsMap.get(yCellKey(newId, 2, 1)) as Y.Map<unknown>).get('raw')).toBe('B')

        // Modify original — copy must not change.
        setYCell(doc, 'sheet1', 1, 1, 'changed')
        expect((cellCopy as Y.Map<unknown>).get('raw')).toBe('A')

        // Style/dim independence.
        setYColWidth(doc, 'sheet1', 1, 300)
        const sheets = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
        const copyMeta = sheets.get(newId)
        const copyWidths = copyMeta?.get('colWidths') as Y.Map<number> | undefined
        expect(copyWidths?.get('1')).toBe(200)
    })

    it('names the duplicate "<name> (copy)" when not taken, " (copy 2)" otherwise', () => {
        const doc = bootstrapBlank()
        const actions = buildSheetActions(doc)
        const sheets = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)

        const id1 = actions.duplicateSheet('sheet1')
        expect(sheets.get(id1)?.get('name')).toBe('Sheet 1 (copy)')

        const id2 = actions.duplicateSheet('sheet1')
        expect(sheets.get(id2)?.get('name')).toBe('Sheet 1 (copy 2)')

        const id3 = actions.duplicateSheet('sheet1')
        expect(sheets.get(id3)?.get('name')).toBe('Sheet 1 (copy 3)')
    })

    it('duplicate of a hidden sheet surfaces visible', () => {
        const doc = bootstrapBlank()
        const actions = buildSheetActions(doc)
        actions.hideSheet('sheet1')
        const newId = actions.duplicateSheet('sheet1')
        const sheets = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
        expect(sheets.get(newId)?.get(SHEET_HIDDEN_KEY)).toBeUndefined()
    })
})

describe('useSheetActions: reorderSheet', () => {
    it('updates position values to match the requested order', () => {
        const doc = bootstrapBlank()
        const actions = buildSheetActions(doc)
        actions.addSheet() // sheet2 @ pos 1
        actions.addSheet() // sheet3 @ pos 2
        actions.reorderSheet('sheet3', 0)
        expect(ydocSheetIds(doc)).toEqual(['sheet3', 'sheet1', 'sheet2'])
        const sheets = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
        expect(sheets.get('sheet3')?.get('position')).toBe(0)
        expect(sheets.get('sheet1')?.get('position')).toBe(1)
        expect(sheets.get('sheet2')?.get('position')).toBe(2)
    })

    it('clamps overflow positions to the end of the strip', () => {
        const doc = bootstrapBlank()
        const actions = buildSheetActions(doc)
        actions.addSheet()
        actions.reorderSheet('sheet1', 99)
        expect(ydocSheetIds(doc)).toEqual(['sheet2', 'sheet1'])
    })
})

describe('useSheetActions: hide / show', () => {
    it('hideSheet sets hidden:true; showSheet clears it', () => {
        const doc = bootstrapBlank()
        const actions = buildSheetActions(doc)
        actions.hideSheet('sheet1')
        const sheets = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
        expect(sheets.get('sheet1')?.get(SHEET_HIDDEN_KEY)).toBe(true)
        actions.showSheet('sheet1')
        expect(sheets.get('sheet1')?.has(SHEET_HIDDEN_KEY)).toBe(false)
    })
})

describe('useSheetActions: setSheetColor', () => {
    it('accepts a hex color and clears it on null/empty', () => {
        const doc = bootstrapBlank()
        const actions = buildSheetActions(doc)
        actions.setSheetColor('sheet1', '#FF0000')
        const sheets = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
        expect(sheets.get('sheet1')?.get(SHEET_COLOR_KEY)).toBe('#FF0000')
        actions.setSheetColor('sheet1', null)
        expect(sheets.get('sheet1')?.has(SHEET_COLOR_KEY)).toBe(false)
        actions.setSheetColor('sheet1', '#00FF00')
        expect(sheets.get('sheet1')?.get(SHEET_COLOR_KEY)).toBe('#00FF00')
        actions.setSheetColor('sheet1', '')
        expect(sheets.get('sheet1')?.has(SHEET_COLOR_KEY)).toBe(false)
    })
})

describe('useSheetActions: noop fallback when doc is null', () => {
    it('returns a stable shape that does nothing', () => {
        const actions = buildSheetActions(null)
        expect(actions.addSheet()).toBe('')
        expect(actions.duplicateSheet('x')).toBe('')
        expect(actions.renameSheet('x', 'y')).toEqual({ ok: false, error: 'No document' })
        // None of these should throw.
        actions.deleteSheet('x')
        actions.reorderSheet('x', 0)
        actions.setSheetColor('x', null)
        actions.hideSheet('x')
        actions.showSheet('x')
    })
})
