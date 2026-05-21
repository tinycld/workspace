// usePrintDocument is a thin orchestration hook. The reusable part —
// fetch the rendered HTML from the server, wrap it in the print
// envelope, hand the document to handlePrint, capture errors — lives
// in the exported pure async helper `printRenderedDocument`. That's
// what we test here, matching the project-wide pattern (vitest runs
// in `node` without jsdom, so the React side isn't exercised in unit
// tests — see calc/tests/pivot-banner.test.tsx for the same
// constraint).
//
// The hook wrapper itself is one line of useCallback and doesn't
// merit its own test.

import type {
    FetchRenderedHtmlOptions,
    RenderedHtml,
} from '@tinycld/core/file-viewer/fetch-rendered-html'
import type { FilePreviewSource } from '@tinycld/core/file-viewer/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
// Import the pure body directly to avoid pulling react-native into
// the vitest transform graph. The hook file (use-print-document.ts)
// re-exports the same symbol from this module — see that file for
// the rationale.
import { printRenderedDocument } from '../tinycld/text/hooks/print-rendered-document'

const SAMPLE_FRAGMENT =
    '<article class="tinycld-text"><h1 class="tinycld-text-h1">Hi</h1><p class="tinycld-text-p">x</p></article>'

function makeDeps(overrides: Partial<TestDeps> = {}) {
    const handlePrint = vi.fn(async (_html: string) => {})
    const captureException = vi.fn()
    const fetchRenderedHtml = vi.fn(
        async (_source: FilePreviewSource, _opts?: FetchRenderedHtmlOptions) =>
            ({ html: SAMPLE_FRAGMENT, etag: '"abc"' }) as RenderedHtml
    )
    const printCss = `
.tinycld-text-p { margin: 0 0 0.5em 0; }
.tinycld-text-h1 { font-size: 18pt; }
`
    return {
        handlePrint,
        captureException,
        fetchRenderedHtml,
        printCss,
        ...overrides,
    }
}

type TestDeps = ReturnType<typeof makeDeps>

let deps: TestDeps
beforeEach(() => {
    deps = makeDeps()
})

describe('printRenderedDocument', () => {
    it('fetches the rendered HTML for the drive item and passes the envelope to handlePrint', async () => {
        await printRenderedDocument('item-123', deps)
        expect(deps.fetchRenderedHtml).toHaveBeenCalledTimes(1)
        const [source, opts] = deps.fetchRenderedHtml.mock.calls[0]
        expect(source.recordId).toBe('item-123')
        expect(source.mimeType).toBe(
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        )
        expect(opts).toEqual({ images: 'embed' })

        expect(deps.handlePrint).toHaveBeenCalledTimes(1)
        const passed = deps.handlePrint.mock.calls[0][0]
        expect(passed.startsWith('<!doctype html>')).toBe(true)
        expect(passed).toContain(SAMPLE_FRAGMENT)
    })

    it('embeds the platform-resolved print CSS in the envelope', async () => {
        await printRenderedDocument('item-1', deps)
        const passed = deps.handlePrint.mock.calls[0][0]
        // The CSS is wrapped in a <style> block inside <head>.
        expect(passed).toMatch(/<head>[\s\S]*<style>[\s\S]*<\/style>[\s\S]*<\/head>/)
        expect(passed).toContain('.tinycld-text-h1 { font-size: 18pt; }')
    })

    it('reports fetchRenderedHtml rejections via captureException without throwing', async () => {
        deps.fetchRenderedHtml.mockRejectedValueOnce(new Error('network down'))
        await expect(printRenderedDocument('id', deps)).resolves.toBeUndefined()
        expect(deps.handlePrint).not.toHaveBeenCalled()
        expect(deps.captureException).toHaveBeenCalledTimes(1)
        const [tag, err] = deps.captureException.mock.calls[0]
        expect(tag).toBe('usePrintDocument')
        expect((err as Error).message).toBe('network down')
    })

    it('reports handlePrint rejections via captureException without throwing', async () => {
        deps.handlePrint.mockRejectedValueOnce(new Error('print failed'))
        await expect(printRenderedDocument('id', deps)).resolves.toBeUndefined()
        expect(deps.captureException).toHaveBeenCalledTimes(1)
        expect((deps.captureException.mock.calls[0][1] as Error).message).toBe(
            'print failed'
        )
    })

    it('produces a self-contained HTML document (no external assets in the CSS layer)', async () => {
        await printRenderedDocument('id', deps)
        const passed = deps.handlePrint.mock.calls[0][0]
        expect(passed).not.toMatch(/<link\b/i)
        expect(passed).not.toMatch(/@import\b/i)
        expect(passed).not.toMatch(/@font-face\b/i)
    })
})
