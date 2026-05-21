import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFromOsClipboard, writeToOsClipboard } from '../tinycld/calc/lib/clipboard/adapter-web'
import { payloadToHtml } from '../tinycld/calc/lib/clipboard/encode-html'
import { payloadToTsv } from '../tinycld/calc/lib/clipboard/encode-tsv'
import { clearAll } from '../tinycld/calc/lib/clipboard/store'
import type { ClipboardPayload } from '../tinycld/calc/lib/clipboard/types'

// adapter-web bridges ClipboardPayload to/from navigator.clipboard. We
// mock the global navigator.clipboard surface and assert the adapter
// passes through the right text/html + text/plain blobs, handles the
// marker round-trip, and tolerates permission denials.

function makePayload(): ClipboardPayload {
    return {
        rows: 1,
        cols: 2,
        cells: [
            [
                { kind: 'string', raw: 'hello' },
                { kind: 'number', raw: 42 },
            ],
        ],
        sourceAnchor: { row: 1, col: 1 },
    }
}

interface MockClipboard {
    writeCalls: Parameters<Clipboard['write']>[0][]
    writeTextCalls: string[]
    readReturn: (Pick<ClipboardItem, 'types'> & { getType: (t: string) => Promise<Blob> })[] | null
    readTextReturn: string | null
    rejectWrite?: boolean
    rejectWriteText?: boolean
    rejectRead?: boolean
    rejectReadText?: boolean
}

function makeMockClipboard(overrides: Partial<MockClipboard> = {}): MockClipboard {
    return {
        writeCalls: [],
        writeTextCalls: [],
        readReturn: null,
        readTextReturn: null,
        ...overrides,
    }
}

function installClipboard(mock: MockClipboard) {
    const clipboard = {
        async write(items: ClipboardItems): Promise<void> {
            if (mock.rejectWrite) throw new Error('write denied')
            mock.writeCalls.push(items)
        },
        async writeText(text: string): Promise<void> {
            if (mock.rejectWriteText) throw new Error('writeText denied')
            mock.writeTextCalls.push(text)
        },
        async read(): Promise<ClipboardItems> {
            if (mock.rejectRead) throw new Error('read denied')
            return (mock.readReturn ?? []) as unknown as ClipboardItems
        },
        async readText(): Promise<string> {
            if (mock.rejectReadText) throw new Error('readText denied')
            return mock.readTextReturn ?? ''
        },
    }
    vi.stubGlobal('navigator', { clipboard })

    // ClipboardItem ctor — mirror the browser shape just enough for
    // the adapter to construct one. We capture the inputs so tests can
    // inspect the blobs that would have been written.
    class MockClipboardItem {
        items: Record<string, Blob>
        constructor(items: Record<string, Blob>) {
            this.items = items
        }
        get types(): string[] {
            return Object.keys(this.items)
        }
        async getType(t: string): Promise<Blob> {
            return this.items[t]
        }
    }
    vi.stubGlobal('ClipboardItem', MockClipboardItem)
}

describe('adapter-web — writeToOsClipboard', () => {
    beforeEach(() => clearAll())
    afterEach(() => vi.unstubAllGlobals())

    it('returns a markerId even when navigator.clipboard is missing', async () => {
        vi.stubGlobal('navigator', {})
        const { markerId, osWriteOk } = await writeToOsClipboard(makePayload())
        expect(typeof markerId).toBe('string')
        expect(markerId.length).toBeGreaterThan(0)
        expect(osWriteOk).toBe(false)
    })

    it('writes both text/html and text/plain via ClipboardItem when available', async () => {
        const mock = makeMockClipboard()
        installClipboard(mock)
        const { markerId, osWriteOk } = await writeToOsClipboard(makePayload())
        expect(osWriteOk).toBe(true)
        expect(mock.writeCalls.length).toBe(1)
        const item = mock.writeCalls[0][0] as unknown as { items: Record<string, Blob> }
        expect(Object.keys(item.items)).toEqual(expect.arrayContaining(['text/html', 'text/plain']))
        // The marker we got back must be present in the HTML payload.
        const html = await item.items['text/html'].text()
        expect(html).toContain(markerId)
    })

    it('falls back to writeText when ClipboardItem-based write rejects', async () => {
        const mock = makeMockClipboard({ rejectWrite: true })
        installClipboard(mock)
        const { osWriteOk } = await writeToOsClipboard(makePayload())
        expect(osWriteOk).toBe(true)
        expect(mock.writeTextCalls.length).toBe(1)
    })

    it('keeps osWriteOk=false but still returns a marker when both writes reject', async () => {
        const mock = makeMockClipboard({
            rejectWrite: true,
            rejectWriteText: true,
        })
        installClipboard(mock)
        const { markerId, osWriteOk } = await writeToOsClipboard(makePayload())
        expect(osWriteOk).toBe(false)
        expect(markerId.length).toBeGreaterThan(0)
    })
})

describe('adapter-web — readFromOsClipboard', () => {
    beforeEach(() => clearAll())
    afterEach(() => vi.unstubAllGlobals())

    it('returns null when navigator.clipboard is missing', async () => {
        vi.stubGlobal('navigator', {})
        expect(await readFromOsClipboard()).toBeNull()
    })

    it('returns the fidelity-store payload when the OS HTML carries our marker', async () => {
        // First write — this puts the payload in the fidelity store.
        const mock1 = makeMockClipboard()
        installClipboard(mock1)
        const written = makePayload()
        const { markerId } = await writeToOsClipboard(written)
        const item = mock1.writeCalls[0][0] as unknown as { items: Record<string, Blob> }
        const writtenHtml = await item.items['text/html'].text()

        // Now read — install a fresh mock that returns the same HTML.
        const mock2 = makeMockClipboard({
            readReturn: [
                {
                    types: ['text/html', 'text/plain'],
                    getType: async (t: string) => {
                        if (t === 'text/html') return new Blob([writtenHtml])
                        return new Blob([payloadToTsv(written)])
                    },
                },
            ],
        })
        installClipboard(mock2)
        const result = await readFromOsClipboard()
        expect(result).not.toBeNull()
        expect(result?.markerId).toBe(markerId)
        // Same object identity confirms fidelity-store hit.
        expect(result?.payload.cells[0][1].raw).toBe(42)
        expect(result?.payload.cells[0][1].kind).toBe('number')
    })

    it('parses HTML when the marker is missing from the fidelity store', async () => {
        const foreign = makePayload()
        const html = payloadToHtml(foreign, 'no-such-marker-stored')
        const mock = makeMockClipboard({
            readReturn: [
                {
                    types: ['text/html', 'text/plain'],
                    getType: async (t: string) => {
                        if (t === 'text/html') return new Blob([html])
                        return new Blob([payloadToTsv(foreign)])
                    },
                },
            ],
        })
        installClipboard(mock)
        const result = await readFromOsClipboard()
        expect(result).not.toBeNull()
        expect(result?.markerId).toBe('no-such-marker-stored')
        // Came back from HTML parse — same shape, fresh object.
        expect(result?.payload.cells[0][1].raw).toBe(42)
    })

    it('parses TSV when HTML is absent', async () => {
        const mock = makeMockClipboard({
            readReturn: [
                {
                    types: ['text/plain'],
                    getType: async () => new Blob(['a\tb\r\nc\td']),
                },
            ],
        })
        installClipboard(mock)
        const result = await readFromOsClipboard()
        expect(result?.payload.rows).toBe(2)
        expect(result?.payload.cells[1][1].raw).toBe('d')
        expect(result?.markerId).toBeNull()
    })

    it('falls back to readText when .read() rejects', async () => {
        const mock = makeMockClipboard({
            rejectRead: true,
            readTextReturn: 'foo\tbar',
        })
        installClipboard(mock)
        const result = await readFromOsClipboard()
        expect(result?.payload.cells[0][1].raw).toBe('bar')
    })

    it('returns null when both read paths fail', async () => {
        const mock = makeMockClipboard({
            rejectRead: true,
            rejectReadText: true,
        })
        installClipboard(mock)
        expect(await readFromOsClipboard()).toBeNull()
    })
})
