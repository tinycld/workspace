// Materializes a template's embedded base64 bytes into a Blob suitable
// for handing to useCreateDriveItem. Modeled on calc's blank-workbook
// helper: base64 in the JS bundle decoded at click time, no Metro
// asset registration, no expo-asset round-trip on web or native.

import { DOCX_MIME_TYPE } from '../mime'
import { getTemplateBase64, type TemplateId } from './index'

/**
 * Returns a freshly-constructed Blob carrying the bytes of the named
 * template. The Blob is typed as the docx MIME type so
 * useCreateDriveItem sees the same content-type the existing blank
 * flow produces. Throws when the id isn't in the generated bundle —
 * indicates a registry/generator drift, not a runtime user error.
 */
export function loadTemplateBlob(id: TemplateId): Blob {
    const b64 = getTemplateBase64(id)
    const bytes = decodeBase64ToBytes(b64)
    // Slice into a fresh ArrayBuffer for TS's strict SharedArrayBuffer
    // narrowing on Blob constructor inputs — mirrors what
    // calc/lib/blank-workbook.ts does for the same reason.
    const ab = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer
    return new Blob([ab], { type: DOCX_MIME_TYPE })
}

// decodeBase64ToBytes lives here (instead of being shared with calc)
// because the two packages don't cross-import at runtime and a shared
// util in core would just add another import boundary for ~15 lines of
// trivial decoder code.
function decodeBase64ToBytes(b64: string): Uint8Array {
    if (typeof atob === 'function') {
        const bin = atob(b64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) {
            bytes[i] = bin.charCodeAt(i)
        }
        return bytes
    }
    // Node fallback (vitest, RN dev builds with a Buffer polyfill).
    type BufferLike = {
        from: (data: string, enc: string) => {
            length: number
            readUInt8: (i: number) => number
        }
    }
    const g = globalThis as unknown as { Buffer?: BufferLike }
    if (g.Buffer) {
        const buf = g.Buffer.from(b64, 'base64')
        const bytes = new Uint8Array(buf.length)
        for (let i = 0; i < buf.length; i++) {
            bytes[i] = buf.readUInt8(i)
        }
        return bytes
    }
    throw new Error('loadTemplateBlob: no base64 decoder available')
}
