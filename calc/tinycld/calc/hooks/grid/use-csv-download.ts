import { useCallback } from 'react'
import type * as Y from 'yjs'
import { downloadCsv } from '../../lib/csv/download'
import { serializeSheetToCsv } from '../../lib/csv/encode'
import { sanitizeFilename } from '../../lib/csv/sanitize-filename'
import type { SheetWithId } from '../use-y-sheets'

export interface CsvDownloadActions {
    // Download the active sheet as <sheetName>.csv.
    downloadCurrent: () => void
    // v1: one download per sheet (multiple "Save As" prompts in browsers).
    // TODO: zip all sheets into a single .zip download.
    downloadAll: () => void
}

export function useCsvDownload(
    doc: Y.Doc,
    sheetId: string,
    sheets: SheetWithId[],
    activeSheetName: string | undefined
): CsvDownloadActions {
    const downloadCurrent = useCallback(() => {
        const csv = serializeSheetToCsv(doc, sheetId)
        const filename = `${sanitizeFilename(activeSheetName ?? 'sheet')}.csv`
        void downloadCsv(filename, csv)
    }, [doc, sheetId, activeSheetName])

    const downloadAll = useCallback(() => {
        for (const s of sheets) {
            const csv = serializeSheetToCsv(doc, s.id)
            const filename = `${sanitizeFilename(s.name)}.csv`
            void downloadCsv(filename, csv)
        }
    }, [doc, sheets])

    return { downloadCurrent, downloadAll }
}
