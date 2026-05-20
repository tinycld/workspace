// @vitest-environment happy-dom

import type { FilePreviewSource } from '@tinycld/core/file-viewer/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tinycld/core/lib/pocketbase', () => ({
    pb: {
        baseURL: 'http://test.invalid',
        authStore: { token: 'test-token' },
    },
}))

const { fetchRenderedHtml, useRenderedHtml } = await import(
    '@tinycld/core/file-viewer/fetch-rendered-html'
)

const reactQuery = await import('@tanstack/react-query')
const React = await import('react')

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function docxSource(): FilePreviewSource {
    return {
        collectionId: 'drive_items',
        recordId: 'rec123',
        fileName: 'doc.docx',
        displayName: 'Doc',
        mimeType: DOCX,
        size: 0,
    }
}

function xlsxSource(): FilePreviewSource {
    return {
        collectionId: 'drive_items',
        recordId: 'rec456',
        fileName: 'wb.xlsx',
        displayName: 'WB',
        mimeType: XLSX,
        size: 0,
    }
}

interface FetchCall {
    url: string
    init?: RequestInit
}

function installFetchMock(impl?: () => Response): FetchCall[] {
    const calls: FetchCall[] = []
    const mock = vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init })
        return (
            impl?.() ??
            new Response('<section/>', {
                status: 200,
                headers: { ETag: '"abc"', 'Content-Type': 'text/html' },
            })
        )
    })
    vi.stubGlobal('fetch', mock)
    return calls
}

describe('fetchRenderedHtml', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('dispatches docx mime type to /api/text/render/:id', async () => {
        const calls = installFetchMock()
        const result = await fetchRenderedHtml(docxSource())
        expect(calls).toHaveLength(1)
        expect(calls[0].url).toBe('http://test.invalid/api/text/render/rec123')
        expect(result.html).toBe('<section/>')
        expect(result.etag).toBe('"abc"')
    })

    it('dispatches xlsx mime type to /api/calc/render/:id', async () => {
        const calls = installFetchMock()
        await fetchRenderedHtml(xlsxSource())
        expect(calls[0].url).toBe('http://test.invalid/api/calc/render/rec456')
    })

    it('serializes calc-specific query params', async () => {
        const calls = installFetchMock()
        await fetchRenderedHtml(xlsxSource(), {
            sheet: 'sheet2',
            range: 'A1:C10',
            scope: 'selection',
            images: 'embed',
        })
        const url = new URL(calls[0].url)
        expect(url.searchParams.get('sheet')).toBe('sheet2')
        expect(url.searchParams.get('range')).toBe('A1:C10')
        expect(url.searchParams.get('scope')).toBe('selection')
        expect(url.searchParams.get('images')).toBe('embed')
    })

    it('serializes text images param', async () => {
        const calls = installFetchMock()
        await fetchRenderedHtml(docxSource(), { images: 'embed' })
        const url = new URL(calls[0].url)
        expect(url.searchParams.get('images')).toBe('embed')
    })

    it('sends Authorization and Accept headers', async () => {
        const calls = installFetchMock()
        await fetchRenderedHtml(docxSource())
        const headers = (calls[0].init?.headers ?? {}) as Record<string, string>
        expect(headers.Authorization).toBe('Bearer test-token')
        expect(headers.Accept).toBe('text/html')
    })

    it('forwards ifNoneMatch as If-None-Match header', async () => {
        const calls = installFetchMock()
        await fetchRenderedHtml(docxSource(), { ifNoneMatch: '"prev"' })
        const headers = (calls[0].init?.headers ?? {}) as Record<string, string>
        expect(headers['If-None-Match']).toBe('"prev"')
    })

    it('returns the supplied etag and empty body on 304', async () => {
        installFetchMock(() => new Response(null, { status: 304 }))
        const result = await fetchRenderedHtml(docxSource(), { ifNoneMatch: '"prev"' })
        expect(result.html).toBe('')
        expect(result.etag).toBe('"prev"')
    })

    it('throws on non-OK status', async () => {
        installFetchMock(() => new Response('boom', { status: 500 }))
        await expect(fetchRenderedHtml(docxSource())).rejects.toThrow(/HTTP 500/)
    })

    it('throws on unsupported mime types', async () => {
        installFetchMock()
        const bad: FilePreviewSource = {
            ...docxSource(),
            mimeType: 'image/png',
        }
        await expect(fetchRenderedHtml(bad)).rejects.toThrow(/unsupported mime type/)
    })
})

// useRenderedHtml exercises the React Query wrapper. The behavior
// we're guarding here is:
//   1. Identical (source, opts) pairs across two mounts must hit
//      the cache — the underlying fetch must NOT fire twice. This
//      regression-tests the inline-object queryKey bug where a fresh
//      `{ images: 'embed' }` literal on every render minted a new
//      cache entry.
//   2. A 304 response must preserve the previously-cached body. The
//      bug overwrote it with an empty string.
describe('useRenderedHtml caching', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
    })
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    function renderHookWithClient<T>(hook: () => T): {
        result: { current: T }
        client: InstanceType<typeof reactQuery.QueryClient>
        rerender: () => void
        unmount: () => void
    } {
        const { renderHook } =
            require('@testing-library/react') as typeof import('@testing-library/react')
        const client = new reactQuery.QueryClient({
            defaultOptions: { queries: { retry: false } },
        })
        const wrapper = ({ children }: { children: React.ReactNode }) =>
            React.createElement(reactQuery.QueryClientProvider, { client }, children)
        const utils = renderHook(hook, { wrapper })
        return {
            result: utils.result,
            client,
            rerender: () => utils.rerender(),
            unmount: () => utils.unmount(),
        }
    }

    it('fires only one fetch when mounted twice with the same (source, opts)', async () => {
        const calls = installFetchMock()
        const source = docxSource()
        const { result, rerender, unmount } = renderHookWithClient(() =>
            // Inline-object opts on every render — this is the pattern
            // consumers use; the queryKey must be stable across it.
            useRenderedHtml(source, { images: 'embed' })
        )
        await vi.waitFor(() => expect(result.current.isSuccess).toBe(true))
        rerender()
        rerender()
        // Allow any spurious refetch to flush.
        await new Promise(r => setTimeout(r, 5))
        expect(calls.length).toBe(1)
        unmount()
    })

    it('preserves the prior body on a 304 revalidation', async () => {
        const responses: Response[] = [
            new Response('<section>v1</section>', {
                status: 200,
                headers: { ETag: '"abc"', 'Content-Type': 'text/html' },
            }),
            new Response(null, { status: 304 }),
        ]
        const calls: FetchCall[] = []
        const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
            calls.push({ url, init })
            const r = responses.shift()
            if (!r) throw new Error('unexpected extra fetch')
            return r
        })
        vi.stubGlobal('fetch', fetchMock)

        const source = docxSource()
        const { result, client, unmount } = renderHookWithClient(() => useRenderedHtml(source))
        await vi.waitFor(() => expect(result.current.isSuccess).toBe(true))
        expect(result.current.data?.html).toBe('<section>v1</section>')
        expect(result.current.data?.etag).toBe('"abc"')

        // Force a revalidation. The mocked second response is a 304.
        await client.refetchQueries({ queryKey: ['rendered-html'] })
        await vi.waitFor(() => expect(calls.length).toBe(2))
        // The second fetch must have carried the prior ETag.
        const secondHeaders = (calls[1].init?.headers ?? {}) as Record<string, string>
        expect(secondHeaders['If-None-Match']).toBe('"abc"')

        // Prior body must be preserved across the 304 — NOT overwritten
        // with an empty string.
        expect(result.current.data?.html).toBe('<section>v1</section>')
        expect(result.current.data?.etag).toBe('"abc"')

        unmount()
    })
})
