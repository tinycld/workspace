import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import { useMemo } from 'react'
import * as Y from 'yjs'
import {
    propagateSheetDelete,
    propagateSheetRename,
} from '../lib/pivot/lifecycle'
import { parseYCellKey, yCellKey } from '../lib/y-cell-key'
import {
    CELLS_MAP,
    cloneYMapDeep,
    SHEET_COLOR_KEY,
    SHEET_HIDDEN_KEY,
    SHEETS_MAP,
    ydocSheetIds,
} from '../lib/y-doc-bootstrap'

// Result shape for actions that may reject (rename + duplicate name
// guard). Keeps callers from threading exceptions through validation.
export type SheetActionResult = { ok: true } | { ok: false; error: string }

export interface SheetActions {
    addSheet(name?: string): string
    renameSheet(id: string, newName: string): SheetActionResult
    deleteSheet(id: string): void
    duplicateSheet(id: string): string
    reorderSheet(id: string, newPosition: number): void
    setSheetColor(id: string, color: string | null): void
    hideSheet(id: string): void
    showSheet(id: string): void
}

// useSheetActions returns typed wrappers around the sheets/cells Y.Maps.
// Every mutation runs inside doc.transact tagged LOCAL_ORIGIN so the
// realtime undo manager captures it as one undoable step.
//
// All actions are no-ops when the doc is null (placeholder during
// realtime-room handshake). Returning null IDs would force callers to
// add an "if (id != null)" branch around every call site; instead the
// hook returns a stable shape and the underlying writes silently skip.
export function useSheetActions(doc: Y.Doc | null): SheetActions {
    return useMemo(() => buildSheetActions(doc), [doc])
}

export function buildSheetActions(doc: Y.Doc | null): SheetActions {
    if (doc == null) {
        return {
            addSheet: () => '',
            renameSheet: () => ({ ok: false, error: 'No document' }),
            deleteSheet: () => {},
            duplicateSheet: () => '',
            reorderSheet: () => {},
            setSheetColor: () => {},
            hideSheet: () => {},
            showSheet: () => {},
        }
    }
    const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)

    const allSheetEntries = (): Array<{ id: string; meta: Y.Map<unknown> }> => {
        const out: Array<{ id: string; meta: Y.Map<unknown> }> = []
        sheetsMap.forEach((meta, id) => {
            if (meta instanceof Y.Map) out.push({ id, meta })
        })
        return out
    }

    const nextSheetIdSuffix = (): string => {
        let max = 0
        sheetsMap.forEach((_, id) => {
            const m = id.match(/^sheet(\d+)$/)
            if (m == null) return
            const n = Number(m[1])
            if (Number.isFinite(n) && n > max) max = n
        })
        return `sheet${max + 1}`
    }

    const nextDefaultSheetName = (): string => {
        let max = 0
        sheetsMap.forEach(meta => {
            const name = meta.get('name')
            if (typeof name !== 'string') return
            // Recognize both `Sheet N` (with space, our default) and
            // `SheetN` (no space — excelize's default in the blank xlsx
            // bootstrap), so the first add after a fresh workbook
            // numbers from the existing Sheet1, not from 1.
            const m = name.match(/^Sheet ?(\d+)$/)
            if (m == null) return
            const n = Number(m[1])
            if (Number.isFinite(n) && n > max) max = n
        })
        return `Sheet ${max + 1}`
    }

    const findUniqueDuplicateName = (originalName: string): string => {
        const existing = new Set<string>()
        sheetsMap.forEach(meta => {
            const name = meta.get('name')
            if (typeof name === 'string') existing.add(name)
        })
        const base = `${originalName} (copy)`
        if (!existing.has(base)) return base
        let n = 2
        while (existing.has(`${originalName} (copy ${n})`)) n++
        return `${originalName} (copy ${n})`
    }

    const isNameTakenByOtherSheet = (name: string, exceptId: string | null): boolean => {
        let taken = false
        sheetsMap.forEach((meta, id) => {
            if (id === exceptId) return
            if (meta.get('name') === name) taken = true
        })
        return taken
    }

    return {
        addSheet(name?: string): string {
            const newId = nextSheetIdSuffix()
            const desiredName = name?.trim() || nextDefaultSheetName()
            const finalName = isNameTakenByOtherSheet(desiredName, null)
                ? `${desiredName} (${newId})`
                : desiredName
            // Position: after every existing sheet, even hidden ones,
            // so the new tab appears at the right edge of the strip.
            let maxPosition = -1
            sheetsMap.forEach(meta => {
                const pos = meta.get('position')
                if (typeof pos === 'number' && pos > maxPosition) maxPosition = pos
            })
            doc.transact(() => {
                const meta = new Y.Map<unknown>()
                meta.set('name', finalName)
                meta.set('position', maxPosition + 1)
                meta.set('rowCount', 0)
                meta.set('colCount', 0)
                sheetsMap.set(newId, meta)
            }, LOCAL_ORIGIN)
            return newId
        },

        renameSheet(id: string, newName: string): SheetActionResult {
            const trimmed = newName.trim()
            if (trimmed.length === 0) {
                return { ok: false, error: 'Name cannot be empty' }
            }
            if (isNameTakenByOtherSheet(trimmed, id)) {
                return { ok: false, error: 'A sheet with this name already exists' }
            }
            const meta = sheetsMap.get(id)
            if (!(meta instanceof Y.Map)) {
                return { ok: false, error: 'Sheet not found' }
            }
            const oldName = meta.get('name')
            doc.transact(() => {
                meta.set('name', trimmed)
                if (typeof oldName === 'string') {
                    propagateSheetRename(doc, oldName, trimmed)
                }
            }, LOCAL_ORIGIN)
            return { ok: true }
        },

        deleteSheet(id: string): void {
            const meta = sheetsMap.get(id)
            if (!(meta instanceof Y.Map)) return
            doc.transact(() => {
                propagateSheetDelete(doc, id)
                sheetsMap.delete(id)
                // Drop every cell whose key starts with this sheetId.
                // Snapshot first — mutating the cells Y.Map while
                // iterating it produces undefined behavior.
                const toDelete: string[] = []
                cellsMap.forEach((_, key) => {
                    const parsed = parseYCellKey(key)
                    if (parsed != null && parsed.sheetId === id) toDelete.push(key)
                })
                for (const key of toDelete) cellsMap.delete(key)
                // Compact positions: remaining sheets renumber from 0
                // upward in their existing order so the visible position
                // sequence stays gapless after a delete.
                const remaining = allSheetEntries()
                    .filter(e => e.id !== id)
                    .sort((a, b) => {
                        const pa = (a.meta.get('position') as number) ?? 0
                        const pb = (b.meta.get('position') as number) ?? 0
                        return pa - pb
                    })
                remaining.forEach((entry, index) => {
                    if (entry.meta.get('position') !== index) {
                        entry.meta.set('position', index)
                    }
                })
            }, LOCAL_ORIGIN)
        },

        duplicateSheet(id: string): string {
            const sourceMeta = sheetsMap.get(id)
            if (!(sourceMeta instanceof Y.Map)) return ''
            const sourceName = (sourceMeta.get('name') as string) ?? id
            const newId = nextSheetIdSuffix()
            const newName = findUniqueDuplicateName(sourceName)
            doc.transact(() => {
                // Clone every metadata key — name/position/rowCount/colCount
                // plus optional sparse maps (colWidths, rowHeights,
                // rowStyles) and the optional color/hidden scalars.
                // hidden is intentionally NOT copied; a duplicate of a
                // hidden sheet should appear visible.
                const newMeta = cloneSheetMetaForDuplicate(sourceMeta, {
                    name: newName,
                })
                let maxPosition = -1
                sheetsMap.forEach(meta => {
                    const pos = meta.get('position')
                    if (typeof pos === 'number' && pos > maxPosition) maxPosition = pos
                })
                newMeta.set('position', maxPosition + 1)
                sheetsMap.set(newId, newMeta)

                // Clone every cell whose key prefix matches the source
                // sheet. Snapshot first — same iteration discipline as
                // delete + structural-mutations.
                const toClone: Array<{ row: number; col: number; cell: Y.Map<unknown> }> = []
                cellsMap.forEach((value, key) => {
                    const parsed = parseYCellKey(key)
                    if (parsed == null || parsed.sheetId !== id) return
                    if (!(value instanceof Y.Map)) return
                    toClone.push({ row: parsed.row, col: parsed.col, cell: value })
                })
                for (const entry of toClone) {
                    const cloned = cloneYMapDeep(entry.cell)
                    cellsMap.set(yCellKey(newId, entry.row, entry.col), cloned)
                }
            }, LOCAL_ORIGIN)
            return newId
        },

        reorderSheet(id: string, newPosition: number): void {
            const meta = sheetsMap.get(id)
            if (!(meta instanceof Y.Map)) return
            const orderedIds = ydocSheetIds(doc).filter(sid => sid !== id)
            const clamped = Math.max(0, Math.min(newPosition, orderedIds.length))
            const finalOrder: string[] = [
                ...orderedIds.slice(0, clamped),
                id,
                ...orderedIds.slice(clamped),
            ]
            doc.transact(() => {
                finalOrder.forEach((sid, idx) => {
                    const m = sheetsMap.get(sid)
                    if (!(m instanceof Y.Map)) return
                    if (m.get('position') !== idx) m.set('position', idx)
                })
            }, LOCAL_ORIGIN)
        },

        setSheetColor(id: string, color: string | null): void {
            const meta = sheetsMap.get(id)
            if (!(meta instanceof Y.Map)) return
            doc.transact(() => {
                if (color == null || color === '') {
                    meta.delete(SHEET_COLOR_KEY)
                } else {
                    meta.set(SHEET_COLOR_KEY, color)
                }
            }, LOCAL_ORIGIN)
        },

        hideSheet(id: string): void {
            const meta = sheetsMap.get(id)
            if (!(meta instanceof Y.Map)) return
            doc.transact(() => {
                meta.set(SHEET_HIDDEN_KEY, true)
            }, LOCAL_ORIGIN)
        },

        showSheet(id: string): void {
            const meta = sheetsMap.get(id)
            if (!(meta instanceof Y.Map)) return
            doc.transact(() => {
                meta.delete(SHEET_HIDDEN_KEY)
            }, LOCAL_ORIGIN)
        },
    }
}

interface CloneSheetOverrides {
    name: string
}

// cloneSheetMetaForDuplicate copies a sheet's metadata Y.Map but
// substitutes the duplicate name and skips the hidden flag (so a
// duplicated hidden sheet surfaces visibly). Position is set by the
// caller after the clone integrates.
function cloneSheetMetaForDuplicate(
    source: Y.Map<unknown>,
    overrides: CloneSheetOverrides
): Y.Map<unknown> {
    const out = new Y.Map<unknown>()
    source.forEach((value, key) => {
        if (key === 'name') {
            out.set('name', overrides.name)
            return
        }
        if (key === 'position') return
        if (key === SHEET_HIDDEN_KEY) return
        if (value instanceof Y.Map) {
            out.set(key, cloneYMapDeep(value as Y.Map<unknown>))
        } else {
            out.set(key, value)
        }
    })
    if (!out.has('name')) out.set('name', overrides.name)
    return out
}
