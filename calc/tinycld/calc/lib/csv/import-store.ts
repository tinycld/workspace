import { create } from '@tinycld/core/lib/store'

// Pending CSV import shared between the calc index (where the user
// picks the file and creates the drive_item) and the detail screen
// (where the Y.Doc bootstraps and the rows actually land). The index
// can't await the realtime handshake itself — handing off through this
// store keeps each screen's responsibilities small.
//
// Keyed by drive_item id so concurrent imports into different
// workbooks don't collide. Drained from the consumer with `take(id)`,
// which removes the entry atomically so the import never re-applies on
// re-render.

export interface PendingCsvImport {
    rows: string[][]
    // Currently always 'new-sheet' for the index → detail handoff (no
    // existing sheet to replace at that point). Carrying the mode keeps
    // the API symmetric with the in-editor path that supports both.
    mode: 'new-sheet' | 'replace-current'
}

interface CsvImportStore {
    pending: Record<string, PendingCsvImport>
    set: (driveItemId: string, value: PendingCsvImport) => void
    take: (driveItemId: string) => PendingCsvImport | null
}

export const useCsvImportStore = create<CsvImportStore>(set => ({
    pending: {},
    set: (driveItemId, value) =>
        set(state => ({ pending: { ...state.pending, [driveItemId]: value } })),
    take: driveItemId => {
        let value: PendingCsvImport | null = null
        set(state => {
            value = state.pending[driveItemId] ?? null
            if (value == null) return state
            const next = { ...state.pending }
            delete next[driveItemId]
            return { pending: next }
        })
        return value
    },
}))
