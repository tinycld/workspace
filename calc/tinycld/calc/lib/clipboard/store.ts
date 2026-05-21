import type { ClipboardPayload } from './types'

// Module-level fidelity store for clipboard payloads.
//
// The OS clipboard is the source of truth for *interop* (calc ↔ Sheets /
// Excel / text editors), but it's lossy: text/plain drops everything
// except `display` strings, text/html preserves visible style but not
// our internal kind / formula text fidelity. To make same-process
// paste round-trip the full ClipboardPayload (kind, raw, formula, style)
// we stash the payload here keyed by a marker UUID; the same UUID is
// embedded in a <meta> tag inside the OS clipboard's text/html. On paste
// we extract the marker from the HTML and look up the in-memory payload
// — if it's still there (same process), full fidelity. If it's not
// (different tab/process, store reset on reload), fall back to parsing
// the HTML/TSV with the `data-tinycld-*` attribute hints.
//
// Why module-level and not React context: clipboard payloads outlive the
// React tree of any one Grid. Two different Grid mounts in the same
// process should share the same store; the OS clipboard is global, so
// the fidelity sidecar is too. Tests can call `clearAll()` to reset.

const store = new Map<string, ClipboardPayload>()

// Bound the store so a long session of copy operations doesn't grow
// unboundedly. 16 is more than enough — a payload only matters for a
// matching paste, which usually follows within seconds. When we exceed
// the cap we evict the oldest entry (insertion order, which Map
// preserves).
const MAX_ENTRIES = 16

export function putPayload(payload: ClipboardPayload): string {
    const markerId = generateMarkerId()
    store.set(markerId, payload)
    if (store.size > MAX_ENTRIES) {
        const oldest = store.keys().next().value
        if (oldest != null) store.delete(oldest)
    }
    return markerId
}

export function getPayload(markerId: string): ClipboardPayload | null {
    return store.get(markerId) ?? null
}

export function clearPayload(markerId: string): void {
    store.delete(markerId)
}

// clearAll is exposed for tests. Not used by production code — a paste
// shouldn't drain the store because the user might paste the same
// payload multiple times.
export function clearAll(): void {
    store.clear()
}

// Prefer crypto.randomUUID when available (web + modern Node); fall
// back to a hand-rolled hex string otherwise. The marker is opaque —
// we only use it as a map key and embed it verbatim in HTML, so any
// collision-resistant string works.
function generateMarkerId(): string {
    const c = globalThis.crypto as { randomUUID?: () => string } | undefined
    if (c?.randomUUID) return c.randomUUID()
    let s = ''
    for (let i = 0; i < 32; i++) {
        s += Math.floor(Math.random() * 16).toString(16)
    }
    return s
}
