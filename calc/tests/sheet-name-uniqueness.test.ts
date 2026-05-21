import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { buildSheetActions } from '../tinycld/calc/hooks/use-sheet-actions'
import { SHEETS_MAP } from '../tinycld/calc/lib/y-doc-bootstrap'

// Focused tests for the rename validation rules and the
// "(copy)" / "(copy N)" name disambiguation that duplicateSheet
// applies. The full sheet-actions surface lives in sheet-actions.test.ts.

function makeDoc(initialNames: string[]): Y.Doc {
    const doc = new Y.Doc()
    const sheets = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    initialNames.forEach((name, i) => {
        const meta = new Y.Map<unknown>()
        meta.set('name', name)
        meta.set('position', i)
        meta.set('rowCount', 0)
        meta.set('colCount', 0)
        sheets.set(`sheet${i + 1}`, meta)
    })
    return doc
}

describe('rename validation', () => {
    it('rejects empty / whitespace-only names', () => {
        const doc = makeDoc(['Sheet 1'])
        const actions = buildSheetActions(doc)
        expect(actions.renameSheet('sheet1', '')).toEqual({
            ok: false,
            error: expect.stringContaining('empty'),
        })
        expect(actions.renameSheet('sheet1', '   \t  ')).toEqual({
            ok: false,
            error: expect.stringContaining('empty'),
        })
    })

    it('rejects names that collide with another sheet (case-sensitive)', () => {
        const doc = makeDoc(['Alpha', 'Beta'])
        const actions = buildSheetActions(doc)
        const r = actions.renameSheet('sheet2', 'Alpha')
        expect(r.ok).toBe(false)

        // Case differs — currently treated as distinct. Matching Excel /
        // Sheets here would mean a case-insensitive comparison. This
        // test pins the current behavior so a future change is a
        // deliberate decision.
        expect(actions.renameSheet('sheet2', 'alpha')).toEqual({ ok: true })
    })

    it('renaming to a sheet\'s own current name is allowed', () => {
        const doc = makeDoc(['Alpha'])
        const actions = buildSheetActions(doc)
        expect(actions.renameSheet('sheet1', 'Alpha')).toEqual({ ok: true })
    })
})

describe('duplicate name disambiguation', () => {
    it('first duplicate appends " (copy)"', () => {
        const doc = makeDoc(['Report'])
        const actions = buildSheetActions(doc)
        const id = actions.duplicateSheet('sheet1')
        const sheets = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
        expect(sheets.get(id)?.get('name')).toBe('Report (copy)')
    })

    it('subsequent duplicates increment the suffix', () => {
        const doc = makeDoc(['Report'])
        const actions = buildSheetActions(doc)
        const id1 = actions.duplicateSheet('sheet1')
        const id2 = actions.duplicateSheet('sheet1')
        const id3 = actions.duplicateSheet('sheet1')
        const sheets = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
        expect(sheets.get(id1)?.get('name')).toBe('Report (copy)')
        expect(sheets.get(id2)?.get('name')).toBe('Report (copy 2)')
        expect(sheets.get(id3)?.get('name')).toBe('Report (copy 3)')
    })

    it('skips a manually-created "(copy)" name and finds the next free slot', () => {
        const doc = makeDoc(['Report', 'Report (copy)'])
        const actions = buildSheetActions(doc)
        const id = actions.duplicateSheet('sheet1')
        const sheets = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
        // "Report (copy)" is taken — fall through to "(copy 2)".
        expect(sheets.get(id)?.get('name')).toBe('Report (copy 2)')
    })
})
