import { describe, expect, it, vi } from 'vitest'

vi.mock('@tinycld/core/lib/pocketbase', () => ({
    pb: {
        files: {
            getURL: (
                record: { collectionId: string; id: string },
                fileName: string,
                opts?: { token?: string }
            ) => {
                const base = `/api/files/${record.collectionId}/${record.id}/${fileName}`
                return opts?.token ? `${base}?token=${opts.token}` : base
            },
        },
        authStore: { isValid: true },
    },
}))

const { buildAuthedFileURL, buildAuthedThumbnailURL } = await import(
    '@tinycld/core/file-viewer/use-authed-file-url'
)

const source = {
    collectionId: 'drive_items',
    recordId: 'rec123',
    fileName: 'doc.pdf',
    displayName: 'doc.pdf',
    mimeType: 'application/pdf',
    size: 100,
}

describe('buildAuthedFileURL', () => {
    it('appends the token as a query parameter when present', () => {
        expect(buildAuthedFileURL(source, 'tok-abc')).toBe(
            '/api/files/drive_items/rec123/doc.pdf?token=tok-abc'
        )
    })

    it('omits the token query param when no token is provided', () => {
        expect(buildAuthedFileURL(source, undefined)).toBe('/api/files/drive_items/rec123/doc.pdf')
    })

    it('returns an empty string when source is missing', () => {
        expect(buildAuthedFileURL(undefined, 'tok')).toBe('')
    })

    it('returns an empty string when fileName is empty', () => {
        expect(buildAuthedFileURL({ ...source, fileName: '' }, 'tok')).toBe('')
    })
})

describe('buildAuthedThumbnailURL', () => {
    const imageSource = { ...source, mimeType: 'image/jpeg', fileName: 'photo.jpg' }
    const pdfWithThumb = { ...source, thumbnailFileName: 'thumb.jpg' }

    it('appends ?thumb= and a token for an image source', () => {
        expect(buildAuthedThumbnailURL(imageSource, '120x120', 'tok-abc')).toBe(
            '/api/files/drive_items/rec123/photo.jpg?token=tok-abc&thumb=120x120'
        )
    })

    it('uses the dedicated thumbnail file when present', () => {
        expect(buildAuthedThumbnailURL(pdfWithThumb, '120x120', undefined)).toBe(
            '/api/files/drive_items/rec123/thumb.jpg?thumb=120x120'
        )
    })

    it('returns an empty string when no thumbnail is available', () => {
        // application/pdf with no thumbnailFileName has no thumbnail base
        expect(buildAuthedThumbnailURL(source, '120x120', 'tok')).toBe('')
    })

    it('returns an empty string when source is missing', () => {
        expect(buildAuthedThumbnailURL(undefined, '120x120', 'tok')).toBe('')
    })
})
