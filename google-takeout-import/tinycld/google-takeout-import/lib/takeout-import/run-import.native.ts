import { captureException } from '@tinycld/core/lib/errors'
import { pb } from '@tinycld/core/lib/pocketbase'
import { useTakeoutImportStore } from '@tinycld/core/lib/stores/takeout-import-store'
import { createBatchInserter } from './batch-inserter'
import { detectOnly, runFallbackImport } from './import-worker-fallback'
import type { ImportContext, ImportService, TakeoutDetection } from './types'

const SERVICE_FOR_RECORD: Record<string, ImportService> = {
    contact: 'contacts',
    calendar: 'calendar',
    calendar_event: 'calendar',
    drive_folder: 'drive',
    drive_file: 'drive',
    mail_thread: 'mail',
}

export async function detect(files: File[], _context: ImportContext): Promise<TakeoutDetection> {
    return detectOnly(files)
}

export async function runImport(files: File[], services: ImportService[], context: ImportContext): Promise<void> {
    const inserter = createBatchInserter({
        pb,
        context,
        onProgress: (recordType, update) => {
            const svc = SERVICE_FOR_RECORD[recordType]
            if (svc) useTakeoutImportStore.getState().updateProgress(svc, update)
        },
        cancelSignal: () => useTakeoutImportStore.getState().cancelRequested,
        onException: captureException,
    })

    await runFallbackImport(files, services, {
        onDetection: () => {},
        onBatch: async (_service, records) => {
            await inserter.insertRecords(records)
        },
        onProgress: (service, phase, total) => {
            useTakeoutImportStore.getState().updateProgress(service, { phase, total })
        },
        onDone: () => {},
        onError: (message) => {
            throw new Error(message)
        },
    })
}

export function requestCancel() {
    useTakeoutImportStore.getState().requestCancel()
}
