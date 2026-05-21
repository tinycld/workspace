import * as Clipboard from 'expo-clipboard'
import type { AdapterReadResult } from './adapter-web'
import { tsvToPayload } from './decode-tsv'
import { payloadToTsv } from './encode-tsv'
import { getPayload, putPayload } from './store'
import type { ClipboardPayload } from './types'

// Native (iOS / Android) clipboard adapter. expo-clipboard exposes
// only text/plain, so we serialize as TSV and stash a (markerId,
// hash) record so a same-process round-trip can recover full fidelity
// (formula / kind / style) from the in-memory store. Cross-app paste
// on native is text-only by design — the user copies from a different
// app and we get just the text.
//
// The hash anchors fidelity: at write time we compute the hash of the
// TSV we wrote and store it next to the marker. At read time, if the
// OS-clipboard text hashes to a marker we recognise, hit the fidelity
// store; otherwise treat the text as TSV.
//
// The hash function is a simple FNV-1a — collision-resistant enough
// for our purposes (mismatch = false fidelity-store miss = fall back
// to TSV, which is correct text content anyway). We don't need crypto-
// grade hashing; an adversary forging a collision gets a TSV-quality
// paste, not data corruption.

interface NativeMarker {
    markerId: string
    tsvHash: string
}

// Bounded history so a long session doesn't grow the map unbounded.
// On native, the clipboard typically only carries one item at a time
// — 4 is plenty.
const MAX_MARKERS = 4
const markerHistory: NativeMarker[] = []

export async function writeToOsClipboard(
    payload: ClipboardPayload
): Promise<{ markerId: string; osWriteOk: boolean }> {
    const markerId = putPayload(payload)
    const tsv = payloadToTsv(payload)
    const tsvHash = fnv1a(tsv)

    markerHistory.push({ markerId, tsvHash })
    if (markerHistory.length > MAX_MARKERS) markerHistory.shift()

    try {
        await Clipboard.setStringAsync(tsv)
        return { markerId, osWriteOk: true }
    } catch {
        // expo-clipboard rejects when the platform's clipboard
        // adapter fails (rare). Same-process paste still works via
        // the fidelity store.
        return { markerId, osWriteOk: false }
    }
}

export async function readFromOsClipboard(): Promise<AdapterReadResult | null> {
    let text: string
    try {
        text = await Clipboard.getStringAsync()
    } catch {
        return null
    }
    if (text.length === 0) return null

    const hash = fnv1a(text)
    for (let i = markerHistory.length - 1; i >= 0; i--) {
        const entry = markerHistory[i]
        if (entry.tsvHash !== hash) continue
        const fidelity = getPayload(entry.markerId)
        if (fidelity != null) {
            return { payload: fidelity, markerId: entry.markerId }
        }
    }

    // No matching marker — fall back to parsing the text as TSV.
    return { payload: tsvToPayload(text), markerId: null }
}

// FNV-1a 32-bit. Good enough for clipboard-content fingerprinting.
function fnv1a(s: string): string {
    let h = 0x811c9dc5
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i)
        h = Math.imul(h, 0x01000193) >>> 0
    }
    return h.toString(16).padStart(8, '0')
}
