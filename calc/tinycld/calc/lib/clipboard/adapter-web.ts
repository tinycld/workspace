import { htmlToPayload } from './decode-html'
import { tsvToPayload } from './decode-tsv'
import { payloadToHtml } from './encode-html'
import { payloadToTsv } from './encode-tsv'
import { getPayload, putPayload } from './store'
import type { ClipboardPayload } from './types'

// Web-only adapter: bridges ClipboardPayload to/from the OS clipboard
// via `navigator.clipboard`. Read returns a payload (preferring the
// fidelity-store hit when the OS clipboard's HTML carries our marker)
// or null when the clipboard is empty/unsupported.
//
// On Safari/Firefox, `navigator.clipboard.write` and `read` may reject
// when the document isn't focused or when the user denies permission.
// Both paths swallow the error, log it, and return null/no-op so the
// caller can fall back to fidelity-store-only behavior.
//
// Two-write strategy on copy: ALWAYS stash in the fidelity store first
// (in-process paste always works), THEN try to write to the OS
// clipboard. If the OS write fails the fidelity payload is still
// addressable by marker — same-process paste keeps working even when
// the clipboard API is unavailable.

export interface AdapterReadResult {
    payload: ClipboardPayload
    markerId: string | null
}

// writeToOsClipboard stashes the payload in the fidelity store, then
// pushes text/html + text/plain to the OS clipboard. Returns the marker
// id (always non-null — the in-memory store always succeeds).
export async function writeToOsClipboard(
    payload: ClipboardPayload
): Promise<{ markerId: string; osWriteOk: boolean }> {
    const markerId = putPayload(payload)
    let osWriteOk = false

    if (typeof navigator === 'undefined' || navigator.clipboard == null) {
        return { markerId, osWriteOk }
    }

    const html = payloadToHtml(payload, markerId)
    const tsv = payloadToTsv(payload)

    try {
        // ClipboardItem is the modern API supporting multiple MIME
        // types. It's available in Chromium, Safari, and Firefox (the
        // last with limitations). We try it first because Sheets and
        // Excel both prefer text/html.
        const Ctor = (
            globalThis as unknown as {
                ClipboardItem?: new (items: Record<string, Blob | PromiseLike<Blob>>) => unknown
            }
        ).ClipboardItem
        if (Ctor != null) {
            const item = new Ctor({
                'text/html': new Blob([html], { type: 'text/html' }),
                'text/plain': new Blob([tsv], { type: 'text/plain' }),
            }) as Parameters<typeof navigator.clipboard.write>[0][number]
            await navigator.clipboard.write([item])
            osWriteOk = true
        } else {
            await navigator.clipboard.writeText(tsv)
            osWriteOk = true
        }
    } catch {
        // Permission denial / missing focus are expected. Fall back to
        // writeText, which Firefox/Safari sometimes accept when the
        // multi-MIME write doesn't. Same-process paste still works via
        // the fidelity store regardless.
        try {
            await navigator.clipboard.writeText(tsv)
            osWriteOk = true
        } catch {
            // Both writes failed — leave osWriteOk=false; the caller's
            // fidelity-store path will carry same-process paste.
        }
    }

    return { markerId, osWriteOk }
}

// readFromOsClipboard pulls a payload out of the OS clipboard. Order
// of preference:
//   1. text/html → extract marker → fidelity-store hit → return full
//      payload with markerId.
//   2. text/html → no marker (or marker miss) → parse the HTML via
//      htmlToPayload.
//   3. text/plain → tsvToPayload.
//   4. Nothing usable → null.
//
// Returns null when the clipboard is empty, unsupported, or the read
// was denied.
export async function readFromOsClipboard(): Promise<AdapterReadResult | null> {
    if (typeof navigator === 'undefined' || navigator.clipboard == null) return null

    // Try the modern multi-MIME read first.
    try {
        const items = await navigator.clipboard.read()
        for (const item of items) {
            const types = item.types ?? []
            if (types.includes('text/html')) {
                const blob = await item.getType('text/html')
                const html = await blob.text()
                const decoded = htmlToPayload(html)
                if (decoded != null) {
                    if (decoded.markerId != null) {
                        const fidelity = getPayload(decoded.markerId)
                        if (fidelity != null) {
                            return { payload: fidelity, markerId: decoded.markerId }
                        }
                    }
                    return { payload: decoded.payload, markerId: decoded.markerId }
                }
            }
            if (types.includes('text/plain')) {
                const blob = await item.getType('text/plain')
                const text = await blob.text()
                if (text.length > 0) {
                    return { payload: tsvToPayload(text), markerId: null }
                }
            }
        }
    } catch {
        // .read() can fail on Firefox (not implemented) or when the
        // user hasn't granted permission. Fall through to readText.
    }

    // Fallback to readText (Firefox & Safari historically supported
    // only this one).
    try {
        const text = await navigator.clipboard.readText()
        if (text.length === 0) return null
        return { payload: tsvToPayload(text), markerId: null }
    } catch {
        return null
    }
}
