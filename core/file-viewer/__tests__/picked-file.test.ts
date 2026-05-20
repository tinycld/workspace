import {
    documentAssetToPickedFile,
    imageAssetToPickedFile,
    webFileToPickedFile,
} from '@tinycld/core/file-viewer/picked-file'
import { describe, expect, it } from 'vitest'

describe('documentAssetToPickedFile', () => {
    it('uses the asset name and mimeType when present', () => {
        const result = documentAssetToPickedFile({
            uri: 'file:///tmp/doc.pdf',
            name: 'invoice.pdf',
            mimeType: 'application/pdf',
            size: 1234,
        })
        expect(result.name).toBe('invoice.pdf')
        expect(result.type).toBe('application/pdf')
        expect(result.size).toBe(1234)
    })

    it('derives a name from the URI when name is missing', () => {
        const result = documentAssetToPickedFile({
            uri: 'file:///tmp/derived.txt',
            name: null,
            mimeType: 'text/plain',
            size: 10,
        })
        expect(result.name).toBe('derived.txt')
    })

    it('falls back to "document" and octet-stream when nothing else is known', () => {
        const result = documentAssetToPickedFile({
            uri: '',
            name: null,
            mimeType: null,
            size: null,
        })
        expect(result.name).toBe('document')
        expect(result.type).toBe('application/octet-stream')
        expect(result.size).toBe(0)
    })

    it('strips a query string from URI-derived names', () => {
        const result = documentAssetToPickedFile({
            uri: 'content://com.android.providers/document?param=1',
            name: null,
            mimeType: 'application/pdf',
            size: 42,
        })
        expect(result.name).toBe('document')
    })
})

describe('imageAssetToPickedFile', () => {
    it('uses the picker fileName when present', () => {
        const result = imageAssetToPickedFile({
            uri: 'file:///tmp/IMG_42.jpg',
            fileName: 'family.jpg',
            mimeType: 'image/jpeg',
            fileSize: 999,
            type: 'image',
        })
        expect(result.name).toBe('family.jpg')
        expect(result.type).toBe('image/jpeg')
        expect(result.size).toBe(999)
    })

    it('derives an image fallback name with a .jpg extension when nothing else is known', () => {
        const result = imageAssetToPickedFile({
            uri: '',
            fileName: null,
            mimeType: null,
            fileSize: null,
            type: 'image',
        })
        expect(result.name).toMatch(/^IMG_\d+\.jpg$/)
        expect(result.type).toBe('image/jpeg')
    })

    it('uses an mp4 fallback for video type', () => {
        const result = imageAssetToPickedFile({
            uri: '',
            fileName: null,
            mimeType: null,
            fileSize: null,
            type: 'video',
        })
        expect(result.name).toMatch(/^IMG_\d+\.mp4$/)
        expect(result.type).toBe('video/mp4')
    })

    it('respects an explicit mimeType for the extension', () => {
        const result = imageAssetToPickedFile({
            uri: 'file:///tmp/foo.heic',
            fileName: null,
            mimeType: 'image/heic',
            fileSize: 100,
            type: 'image',
        })
        expect(result.name).toBe('foo.heic')
        expect(result.type).toBe('image/heic')
    })
})

describe('webFileToPickedFile', () => {
    it('passes through the File object directly', () => {
        const file = new File([new Uint8Array(5)], 'photo.png', { type: 'image/png' })
        const result = webFileToPickedFile(file)
        expect(result.name).toBe('photo.png')
        expect(result.type).toBe('image/png')
        expect(result.size).toBe(5)
        expect(result.file).toBe(file)
    })
})
