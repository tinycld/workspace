import { captureException } from '@tinycld/core/lib/errors'

// handlePrint (web) injects the print HTML directly into the parent
// document under a dedicated `#tinycld-print-root` container and calls
// `window.print()` on the parent window. `@media print` rules toggle
// visibility so only the print container is shown when printing.
//
// We deliberately avoid the iframe + `iframe.contentWindow.print()`
// approach. Chrome leaves focus inside the iframe's browsing context
// after `print()` returns; `window.focus()` cannot restore parent
// focus due to platform security restrictions; the result is a page
// where `document.hasFocus()` stays false and trusted clicks do not
// dispatch normally even after the iframe is removed. Printing on
// the parent window keeps focus where it already is.
//
// Returns when the print dialog closes. Setup errors are reported
// via captureException and the dialog stays open so the user can
// retry.
const PRINT_ROOT_ID = 'tinycld-print-root'
const PRINT_STYLE_ID = 'tinycld-print-style'

// CSS that hides every direct child of <body> except the print root
// during print, and inverts visibility outside print. The `!important`
// markers are necessary because RN-Web inlines styles on most nodes.
const PRINT_CSS = `
#${PRINT_ROOT_ID} { display: none; }
@media print {
    html, body { background: #fff !important; }
    body > *:not(#${PRINT_ROOT_ID}) { display: none !important; }
    #${PRINT_ROOT_ID} {
        display: block !important;
        position: static !important;
    }
}
`

// Strip the <html>/<head>/<body> wrappers from the rendered print HTML
// so we can re-host its <style> + <body> contents inside the parent
// document. The renderer always produces a self-contained document,
// so we expect both tags to be present; we fall back to using the raw
// string if parsing fails (e.g. malformed HTML).
function extractStylesAndBody(html: string): { styles: string; body: string } {
    try {
        const parser = new DOMParser()
        const doc = parser.parseFromString(html, 'text/html')
        const styles = Array.from(doc.head.querySelectorAll('style'))
            .map(s => s.textContent || '')
            .join('\n')
        const body = doc.body.innerHTML
        return { styles, body }
    } catch (err) {
        captureException('handlePrint.web:parse', err)
        return { styles: '', body: html }
    }
}

export async function handlePrint(html: string): Promise<void> {
    if (typeof document === 'undefined') {
        return
    }

    const { styles, body } = extractStylesAndBody(html)

    // Install the @media print rules (idempotent — remove any leftover
    // from a previous run that didn't clean up).
    document.getElementById(PRINT_STYLE_ID)?.remove()
    document.getElementById(PRINT_ROOT_ID)?.remove()

    const styleEl = document.createElement('style')
    styleEl.id = PRINT_STYLE_ID
    // The per-document print styles from the renderer (column widths,
    // page size, font choices) need to apply in print mode too. We
    // scope them under `@media print` so they don't leak into screen.
    styleEl.textContent = `${PRINT_CSS}\n@media print {\n${styles}\n}\n`
    document.head.appendChild(styleEl)

    const printRoot = document.createElement('div')
    printRoot.id = PRINT_ROOT_ID
    printRoot.innerHTML = body
    document.body.appendChild(printRoot)

    await new Promise<void>(resolve => {
        let done = false
        const cleanup = () => {
            if (done) return
            done = true
            window.removeEventListener('afterprint', onAfterPrint)
            clearTimeout(fallbackTimer)
            printRoot.remove()
            styleEl.remove()
            resolve()
        }
        const onAfterPrint = () => cleanup()
        window.addEventListener('afterprint', onAfterPrint)
        // Long-tail leak guard for environments where `afterprint`
        // never fires (some headless or automation contexts). It
        // must NOT race the real print flow: in Firefox and in
        // Chrome's PDF-preview pane, `window.print()` returns
        // immediately while the preview stays open, and tearing
        // down `printRoot` mid-preview prints the hidden app UI as
        // a blank page. Keeping this generous (5 min) means real
        // users always hit the `afterprint` path; only abandoned
        // headless contexts hit the timer.
        const fallbackTimer = window.setTimeout(cleanup, 5 * 60 * 1000)

        try {
            window.print()
        } catch (err) {
            captureException('handlePrint.web', err)
            cleanup()
        }
    })
}
