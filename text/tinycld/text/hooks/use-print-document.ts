import { useCallback } from 'react'
import { Platform } from 'react-native'
import { handlePrint } from '../lib/print/handle-print'
import { buildTextPrintCssNative } from '../lib/print/print-css-native'
import { buildTextPrintCssWeb } from '../lib/print/print-css-web'
import {
    captureException,
    fetchRenderedHtml,
    printRenderedDocument,
} from './print-rendered-document'

// printCssForPlatform picks the right CSS module for the current
// platform. Web prints to a real browser print dialog; native prints
// to expo-print, which runs the HTML in a system WebView. The web
// stylesheet uses page-rule features the native renderer ignores;
// the native variant is currently a re-export of the web rules (see
// lib/print/print-css-native.ts).
function printCssForPlatform(): string {
    if (Platform.OS === 'web') return buildTextPrintCssWeb()
    return buildTextPrintCssNative()
}

// usePrintDocument returns a stable callback that prints the
// document referenced by `driveItemId`. Routes through the server's
// /api/text/render endpoint, which means printing no longer
// requires the editor to be mounted. The drive preview, share view,
// and any future "Print from list" surface can trigger this with
// just a driveItemId.
//
// The previous signature (taking an EditorHandle and calling
// editor.getHTML()) is gone. Replace with the driveItemId-only call.
//
// Errors are captured (with cancellation suppressed inside the
// native handler), so callers don't need their own try/catch.
export function usePrintDocument(driveItemId: string) {
    return useCallback(
        () =>
            printRenderedDocument(driveItemId, {
                handlePrint,
                fetchRenderedHtml,
                captureException,
                printCss: printCssForPlatform(),
            }),
        [driveItemId]
    )
}

// Re-export the pure body for tests; the React-renderer-free entry
// lives in print-rendered-document.ts so a vitest node environment
// can import it without touching react-native.
export { printRenderedDocument } from './print-rendered-document'
