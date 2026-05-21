import { captureException } from '@tinycld/core/lib/errors'
import { pb } from '@tinycld/core/lib/pocketbase'
import { useTakeoutImportStore } from '@tinycld/core/lib/stores/takeout-import-store'
import { createBatchInserter } from './batch-inserter'
import { detectOnly, runFallbackImport } from './import-worker-fallback'
import type { ImportContext, ImportService, TakeoutDetection } from './types'
import { bridgeDetect, bridgeRequestCancel, bridgeRunImport, terminateBridge } from './worker-bridge'

const SERVICE_FOR_RECORD: Record<string, ImportService> = {
    contact: 'contacts',
    calendar: 'calendar',
    calendar_event: 'calendar',
    drive_folder: 'drive',
    drive_file: 'drive',
    mail_thread: 'mail',
}

let useFallback = typeof Worker === 'undefined'

function activateFallback() {
    useFallback = true
    terminateBridge()
    useTakeoutImportStore.getState().setFallbackActive(true)
}

export async function detect(files: File[], context: ImportContext): Promise<TakeoutDetection> {
    if (useFallback) return detectOnly(files)
    try {
        return await bridgeDetect(files, context)
    } catch (err) {
        if (isWorkerConstructionError(err)) {
            activateFallback()
            return detectOnly(files)
        }
        throw err
    }
}

export async function runImport(files: File[], services: ImportService[], context: ImportContext): Promise<void> {
    if (useFallback) {
        await runOnMainThread(files, services, context)
        return
    }
    try {
        await bridgeRunImport(files, services, context)
    } catch (err) {
        if (isWorkerConstructionError(err)) {
            activateFallback()
            await runOnMainThread(files, services, context)
            return
        }
        throw err
    }
}

export function requestCancel() {
    useTakeoutImportStore.getState().requestCancel()
    if (!useFallback) bridgeRequestCancel()
}

function isWorkerConstructionError(err: unknown): boolean {
    if (!(err instanceof Error)) return false
    return err.message.includes('Worker') || err.message.includes('worker') || err.name === 'SecurityError'
}

async function runOnMainThread(files: File[], services: ImportService[], context: ImportContext) {
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
