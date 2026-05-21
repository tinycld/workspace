// The web editor's handlePaste / handleDrop hooks delegate to these
// pure helpers. They have to be permissive about non-image content
// (we must NOT swallow a styled-text paste from another tab), so the
// tests focus on the "did we accidentally pick up the wrong thing"
// failure mode.

import { describe, expect, it } from 'vitest'
import {
    extractImageFilesFromDrop,
    extractImageFilesFromPaste,
} from '../tinycld/text/lib/extract-image-files'

function fakeFile(type: string, name = 'x'): File {
    // Real File constructor works under happy-dom / jsdom but we run
    // under node. A duck-typed object is enough — the helpers only
    // read `.type`.
    return { type, name, size: 1 } as unknown as File
}

function fakeClipboardItem(kind: string, type: string, file: File | null) {
    return { kind, type, getAsFile: () => file }
}

describe('extractImageFilesFromPaste', () => {
    it('returns [] when clipboardData is null (e.g. programmatic paste in some browsers)', () => {
        expect(extractImageFilesFromPaste({ clipboardData: null })).toEqual([])
    })

    it('returns [] when items is missing', () => {
        expect(extractImageFilesFromPaste({ clipboardData: {} })).toEqual([])
    })

    it('returns [] for a pure styled-text paste (string items, no files)', () => {
        const items = [
            { kind: 'string', type: 'text/html', getAsFile: () => null },
            { kind: 'string', type: 'text/plain', getAsFile: () => null },
        ]
        expect(extractImageFilesFromPaste({ clipboardData: { items } })).toEqual([])
    })

    it('returns the image file when an image is pasted alongside an html fallback', () => {
        const png = fakeFile('image/png', 'pasted.png')
        const items = [
            { kind: 'string', type: 'text/html', getAsFile: () => null },
            fakeClipboardItem('file', 'image/png', png),
        ]
        const out = extractImageFilesFromPaste({ clipboardData: { items } })
        expect(out).toEqual([png])
    })

    it('skips non-image file items (e.g. a pasted PDF)', () => {
        const pdf = fakeFile('application/pdf')
        const items = [fakeClipboardItem('file', 'application/pdf', pdf)]
        expect(extractImageFilesFromPaste({ clipboardData: { items } })).toEqual([])
    })

    it('skips items whose getAsFile returns null', () => {
        const items = [fakeClipboardItem('file', 'image/png', null)]
        expect(extractImageFilesFromPaste({ clipboardData: { items } })).toEqual([])
    })

    it('returns multiple image files when several images are pasted', () => {
        const a = fakeFile('image/png')
        const b = fakeFile('image/jpeg')
        const items = [
            fakeClipboardItem('file', 'image/png', a),
            fakeClipboardItem('file', 'image/jpeg', b),
        ]
        expect(extractImageFilesFromPaste({ clipboardData: { items } })).toEqual([a, b])
    })
})

describe('extractImageFilesFromDrop', () => {
    it('returns [] when dataTransfer is null', () => {
        expect(extractImageFilesFromDrop({ dataTransfer: null })).toEqual([])
    })

    it('returns [] when files is missing', () => {
        expect(extractImageFilesFromDrop({ dataTransfer: {} })).toEqual([])
    })

    it('filters non-image files out of a mixed drop', () => {
        const png = fakeFile('image/png')
        const txt = fakeFile('text/plain')
        const files = [png, txt]
        expect(extractImageFilesFromDrop({ dataTransfer: { files } })).toEqual([png])
    })

    it('returns [] when the drop has no image-typed files', () => {
        const pdf = fakeFile('application/pdf')
        const files = [pdf]
        expect(extractImageFilesFromDrop({ dataTransfer: { files } })).toEqual([])
    })

    it('preserves drop order across multiple images', () => {
        const a = fakeFile('image/png', 'a')
        const b = fakeFile('image/jpeg', 'b')
        const files = [a, b]
        expect(extractImageFilesFromDrop({ dataTransfer: { files } })).toEqual([a, b])
    })
})
