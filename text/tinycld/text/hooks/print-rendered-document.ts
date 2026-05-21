import { fetchRenderedHtml as defaultFetchRenderedHtml } from '@tinycld/core/file-viewer/fetch-rendered-html'
import type { FilePreviewSource } from '@tinycld/core/file-viewer/types'
import { captureException as defaultCaptureException } from '@tinycld/core/lib/errors'
import { renderPrintEnvelope } from '@tinycld/core/lib/print/render-print-envelope'
import { DOCX_MIME_TYPE } from '../lib/mime'

// printRenderedDocument is the pure orchestration body of the print
// hook: fetch the server-rendered HTML, wrap it in the print
// envelope, hand it to the platform print handler, and capture any
// failures. Split into its own file (separate from
// use-print-document.ts) so vitest can import it in a `node` test
// environment without dragging react-native into the transform
// graph — the hook file itself imports Platform from react-native
// and is hence test-environment-incompatible.
//
// Every dependency is explicit so tests can stub them. Real callers
// always go through usePrintDocument which fills the defaults in.
export interface PrintRenderedDocumentDeps {
    handlePrint: (html: string) => Promise<void>
    fetchRenderedHtml: typeof defaultFetchRenderedHtml
    captureException: (tag: string, err: unknown) => void
    /** Platform-specific print CSS (web or native variant). */
    printCss: string
}

export async function printRenderedDocument(
    driveItemId: string,
    deps: PrintRenderedDocumentDeps
): Promise<void> {
    try {
        const source: FilePreviewSource = {
            collectionId: 'drive_items',
            recordId: driveItemId,
            fileName: '',
            displayName: '',
            mimeType: DOCX_MIME_TYPE,
            size: 0,
        }
        const { html } = await deps.fetchRenderedHtml(source, { images: 'embed' })
        const envelope = renderPrintEnvelope(html, deps.printCss)
        await deps.handlePrint(envelope)
    } catch (err) {
        deps.captureException('usePrintDocument', err)
    }
}

// Re-export the default helpers so use-print-document.ts can fill
// them in as deps without re-importing from core.
export {
    defaultFetchRenderedHtml as fetchRenderedHtml,
    defaultCaptureException as captureException,
}
