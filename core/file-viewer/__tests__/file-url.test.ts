import { pickThumbnailBase } from '@tinycld/core/file-viewer/pick-thumbnail-base'
import { describe, expect, it } from 'vitest'

describe('pickThumbnailBase', () => {
    it('returns the dedicated thumbnail filename when present', () => {
        expect(
            pickThumbnailBase({
                mimeType: 'application/pdf',
                fileName: 'doc_abc.pdf',
                thumbnailFileName: 'thumb_abc.jpg',
            })
        ).toBe('thumb_abc.jpg')
    })

    it('falls back to the original file for image MIME types', () => {
        expect(pickThumbnailBase({ mimeType: 'image/jpeg', fileName: 'photo_xyz.jpg' })).toBe(
            'photo_xyz.jpg'
        )
        expect(pickThumbnailBase({ mimeType: 'image/png', fileName: 'pic.png' })).toBe('pic.png')
    })

    it('returns empty string for non-image types without a dedicated thumbnail', () => {
        expect(pickThumbnailBase({ mimeType: 'application/pdf', fileName: 'doc.pdf' })).toBe('')
        expect(pickThumbnailBase({ mimeType: 'video/mp4', fileName: 'clip.mp4' })).toBe('')
    })

    it('returns empty string when fileName is missing on an image type', () => {
        expect(pickThumbnailBase({ mimeType: 'image/jpeg', fileName: '' })).toBe('')
    })

    it('prefers a dedicated thumbnail even on image types', () => {
        expect(
            pickThumbnailBase({
                mimeType: 'image/png',
                fileName: 'big.png',
                thumbnailFileName: 'small.jpg',
            })
        ).toBe('small.jpg')
    })
})
