import { useTakeoutImportStore } from '@tinycld/core/lib/stores/takeout-import-store'
import {
    __setBridgeWorkerFactoryForTests,
    bridgeDetect,
    bridgeRunImport,
    terminateBridge,
} from '@tinycld/google-takeout-import/lib/takeout-import/worker-bridge'
import type { WorkerToMain } from '@tinycld/google-takeout-import/lib/takeout-import/worker-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tinycld/core/lib/pocketbase', () => ({
    pb: {
        authStore: { token: 'test-token', record: { id: 'user1' } },
    },
}))

vi.mock('@tinycld/core/lib/config', () => ({
    PB_SERVER_ADDR: 'http://localhost:7090',
}))

function createMockWorker() {
    const listeners = new Map<string, ((ev: unknown) => void)[]>()
    const posted: unknown[] = []

    const worker = {
        postMessage: (msg: unknown) => {
            posted.push(msg)
        },
        addEventListener: (type: string, listener: (ev: unknown) => void) => {
            const existing = listeners.get(type) ?? []
            existing.push(listener)
            listeners.set(type, existing)
        },
        terminate: vi.fn(),
    }

    function emit(msg: WorkerToMain) {
        const messageListeners = listeners.get('message') ?? []
        for (const listener of messageListeners) {
            listener({ data: msg } as MessageEvent)
        }
    }

    return { worker: worker as unknown as Worker, emit, posted }
}

describe('worker-bridge', () => {
    afterEach(() => {
        terminateBridge()
        __setBridgeWorkerFactoryForTests(null)
        useTakeoutImportStore.getState().reset()
    })

    it('sends init on first detect and resolves with detection', async () => {
        const { worker, emit, posted } = createMockWorker()
        __setBridgeWorkerFactoryForTests(() => worker)

        const context = { orgId: 'org1', userOrgId: 'uo1', mailboxId: null }
        const detectPromise = bridgeDetect([], context)

        // Worker should have received 'init' as first message
        expect(posted).toHaveLength(1)
        expect((posted[0] as Record<string, unknown>).type).toBe('init')

        // Simulate ready
        emit({ type: 'ready' })

        // After ready resolves, bridge should have posted 'detect'
        await new Promise(r => setTimeout(r, 10))
        expect(posted).toHaveLength(2)
        expect((posted[1] as Record<string, unknown>).type).toBe('detect')

        // Simulate detection response
        const detection = {
            hasContacts: true,
            hasCalendar: false,
            hasDrive: false,
            hasMail: false,
            contactCount: 5,
            eventCount: 0,
            driveFileCount: 0,
            mailThreadCount: 0,
            fileCount: 1,
            totalSize: 1024,
        }
        emit({ type: 'detection', detection })

        const result = await detectPromise
        expect(result).toEqual(detection)
    })

    it('updates store progress on service-phase messages', async () => {
        const { worker, emit, posted } = createMockWorker()
        __setBridgeWorkerFactoryForTests(() => worker)

        const context = { orgId: 'org1', userOrgId: 'uo1', mailboxId: null }
        const importPromise = bridgeRunImport([], ['contacts'], context)

        // Simulate ready
        emit({ type: 'ready' })
        await new Promise(r => setTimeout(r, 10))

        // Should have sent init + start-import
        expect(posted).toHaveLength(2)

        // Simulate progress
        emit({ type: 'service-phase', service: 'contacts', phase: 'importing', total: 10 })
        emit({ type: 'progress', service: 'contacts', update: { imported: 3 } })

        const state = useTakeoutImportStore.getState()
        expect(state.progress.contacts.total).toBe(10)
        expect(state.progress.contacts.imported).toBe(3)

        // Simulate completion
        emit({ type: 'complete' })
        await importPromise
    })

    it('resolves on cancelled message', async () => {
        const { worker, emit } = createMockWorker()
        __setBridgeWorkerFactoryForTests(() => worker)

        const context = { orgId: 'org1', userOrgId: 'uo1', mailboxId: null }
        const importPromise = bridgeRunImport([], ['contacts'], context)

        emit({ type: 'ready' })
        await new Promise(r => setTimeout(r, 10))

        emit({ type: 'cancelled' })
        await importPromise
    })

    it('rejects on error message', async () => {
        const { worker, emit } = createMockWorker()
        __setBridgeWorkerFactoryForTests(() => worker)

        const context = { orgId: 'org1', userOrgId: 'uo1', mailboxId: null }
        const importPromise = bridgeRunImport([], ['contacts'], context)

        emit({ type: 'ready' })
        await new Promise(r => setTimeout(r, 10))

        emit({ type: 'error', message: 'something broke' })

        await expect(importPromise).rejects.toThrow('something broke')
    })
})
