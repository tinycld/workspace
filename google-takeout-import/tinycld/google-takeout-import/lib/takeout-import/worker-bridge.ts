import { PB_SERVER_ADDR } from '@tinycld/core/lib/config'
import { pb } from '@tinycld/core/lib/pocketbase'
import { useTakeoutImportStore } from '@tinycld/core/lib/stores/takeout-import-store'
import type { ImportContext, ImportService, TakeoutDetection } from './types'
import type { MainToWorker, WorkerToMain } from './worker-protocol'

type BridgeResolver<T> = {
    resolve: (value: T) => void
    reject: (err: Error) => void
}

type Bridge = {
    worker: Worker
    ready: Promise<void>
    detectResolver: BridgeResolver<TakeoutDetection> | null
    importResolver: BridgeResolver<void> | null
}

let bridge: Bridge | null = null
let workerFactory: (() => Worker) | null = null

function createDefaultWorker(): Worker {
    return new Worker(new URL('./worker', window.location.href))
}

function onBridgeMessage(ref: Bridge, msg: WorkerToMain) {
    const store = useTakeoutImportStore.getState()
    switch (msg.type) {
        case 'ready':
            break
        case 'detection':
            ref.detectResolver?.resolve(msg.detection)
            ref.detectResolver = null
            break
        case 'service-phase':
            store.updateProgress(msg.service, { phase: msg.phase, total: msg.total })
            break
        case 'progress':
            store.updateProgress(msg.service, msg.update)
            break
        case 'complete':
            ref.importResolver?.resolve()
            ref.importResolver = null
            break
        case 'cancelled':
            ref.importResolver?.resolve()
            ref.importResolver = null
            break
        case 'error':
            ref.importResolver?.reject(new Error(msg.message))
            ref.importResolver = null
            ref.detectResolver?.reject(new Error(msg.message))
            ref.detectResolver = null
            break
    }
}

function ensureBridge(context: ImportContext): Bridge {
    if (bridge) return bridge

    const factory = workerFactory || createDefaultWorker
    const worker = factory()
    const ref: Bridge = {
        worker,
        ready: Promise.resolve(),
        detectResolver: null,
        importResolver: null,
    }

    ref.ready = new Promise<void>((resolve, reject) => {
        const onMessage = (event: MessageEvent<WorkerToMain>) => {
            if (event.data.type === 'ready') {
                resolve()
                return
            }
            onBridgeMessage(ref, event.data)
        }
        worker.addEventListener('message', onMessage)
        worker.addEventListener('error', (event) => {
            reject(new Error(event.message || 'Worker failed to start'))
        })
    })

    const initMsg: MainToWorker = {
        type: 'init',
        authToken: pb.authStore.token,
        authRecord: pb.authStore.record,
        serverAddr: PB_SERVER_ADDR,
        context,
    }
    worker.postMessage(initMsg)

    bridge = ref
    return ref
}

function send(msg: MainToWorker) {
    if (!bridge) throw new Error('Worker bridge not initialized')
    bridge.worker.postMessage(msg)
}

export async function bridgeDetect(files: File[], context: ImportContext) {
    const ref = ensureBridge(context)
    await ref.ready
    return new Promise<TakeoutDetection>((resolve, reject) => {
        ref.detectResolver = { resolve, reject }
        send({ type: 'detect', files })
    })
}

export async function bridgeRunImport(files: File[], services: ImportService[], context: ImportContext) {
    const ref = ensureBridge(context)
    await ref.ready
    return new Promise<void>((resolve, reject) => {
        ref.importResolver = { resolve, reject }
        send({ type: 'start-import', files, services })
    })
}

export function bridgeRequestCancel() {
    if (!bridge) return
    send({ type: 'cancel' })
}

export function terminateBridge() {
    if (!bridge) return
    bridge.worker.terminate()
    bridge.detectResolver?.reject(new Error('Worker terminated'))
    bridge.importResolver?.reject(new Error('Worker terminated'))
    bridge = null
}

// Exposed for unit tests — injects a custom Worker factory and resets the singleton.
export function __setBridgeWorkerFactoryForTests(factory: (() => Worker) | null) {
    bridge = null
    workerFactory = factory
}
