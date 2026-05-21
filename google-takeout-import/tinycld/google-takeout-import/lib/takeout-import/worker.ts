/// <reference lib="webworker" />
import PocketBase from 'pocketbase'
import { createBatchInserter } from './batch-inserter'
import { detectOnly, runFallbackImport } from './import-worker-fallback'
import type { ImportContext, ImportService, ParsedRecord } from './types'
import type { MainToWorker, WorkerToMain } from './worker-protocol'

declare const self: DedicatedWorkerGlobalScope

let pb: PocketBase | null = null
let context: ImportContext | null = null
let cancelled = false

const SERVICE_FOR_RECORD: Record<string, ImportService> = {
    contact: 'contacts',
    calendar: 'calendar',
    calendar_event: 'calendar',
    drive_folder: 'drive',
    drive_file: 'drive',
    mail_thread: 'mail',
}

function post(msg: WorkerToMain) {
    self.postMessage(msg)
}

self.onmessage = async (event: MessageEvent<MainToWorker>) => {
    const msg = event.data
    try {
        switch (msg.type) {
            case 'init':
                pb = new PocketBase(msg.serverAddr)
                pb.authStore.save(msg.authToken, msg.authRecord)
                pb.autoCancellation(false)
                context = msg.context
                post({ type: 'ready' })
                break
            case 'detect': {
                const detection = await detectOnly(msg.files)
                post({ type: 'detection', detection })
                break
            }
            case 'start-import':
                cancelled = false
                await runImport(msg.services, msg.files)
                break
            case 'cancel':
                cancelled = true
                break
        }
    } catch (err) {
        post({
            type: 'error',
            message: err instanceof Error ? err.message : 'Worker error',
        })
    }
}

async function runImport(services: ImportService[], files: File[]) {
    if (!pb || !context) {
        post({ type: 'error', message: 'Worker not initialized' })
        return
    }

    const inserter = createBatchInserter({
        pb,
        context,
        onProgress: (recordType, update) => {
            const svc = SERVICE_FOR_RECORD[recordType]
            if (svc) post({ type: 'progress', service: svc, update })
        },
        cancelSignal: () => cancelled,
    })

    await runFallbackImport(files, services, {
        onDetection: () => {},
        onBatch: async (_service: ImportService, records: ParsedRecord[]) => {
            if (cancelled) return
            await inserter.insertRecords(records)
        },
        onProgress: (service: ImportService, phase: 'scanning' | 'importing' | 'done', total: number) => {
            post({ type: 'service-phase', service, phase, total })
        },
        onDone: () => {},
        onError: (message: string) => {
            throw new Error(message)
        },
    })

    if (cancelled) {
        post({ type: 'cancelled' })
    } else {
        post({ type: 'complete' })
    }
}
