import { describe, expect, it } from 'vitest'
import {
    attachmentToSource,
    cleanFilename,
    mimeFromFilename,
} from '../tinycld/mail/components/attachment-preview-source'

describe('cleanFilename', () => {
    it('strips a 10-char random suffix from the basename', () => {
        expect(cleanFilename('invoice_aBc1234567.pdf')).toBe('invoice.pdf')
    })

    it('returns the original filename when no suffix pattern matches', () => {
        expect(cleanFilename('plain.pdf')).toBe('plain.pdf')
        expect(cleanFilename('with-dashes.png')).toBe('with-dashes.png')
    })

    it('only strips a suffix that is exactly 10 alphanumeric chars', () => {
        // 9 chars — leave alone
        expect(cleanFilename('foo_abc123456.pdf')).toBe('foo_abc123456.pdf')
        // 11 chars — leave alone
        expect(cleanFilename('foo_abc12345678.pdf')).toBe('foo_abc12345678.pdf')
    })

    it('handles names with multiple underscores', () => {
        expect(cleanFilename('my_file_aBc1234567.docx')).toBe('my_file.docx')
    })
})

describe('mimeFromFilename', () => {
    it.each([
        ['photo.jpg', 'image/jpeg'],
        ['photo.JPEG', 'image/jpeg'],
        ['logo.png', 'image/png'],
        ['report.pdf', 'application/pdf'],
        ['data.csv', 'text/csv'],
        ['notes.txt', 'text/plain'],
        ['backup.zip', 'application/zip'],
        ['video.mp4', 'video/mp4'],
        ['picture.heic', 'image/heic'],
        [
            'contract.docx',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ],
    ])('%s → %s', (name, expected) => {
        expect(mimeFromFilename(name)).toBe(expected)
    })

    it('falls back to application/octet-stream for unknown extensions', () => {
        expect(mimeFromFilename('weird.xyz')).toBe('application/octet-stream')
        expect(mimeFromFilename('noextension')).toBe('application/octet-stream')
    })
})

describe('attachmentToSource', () => {
    it('builds a FilePreviewSource with cleaned displayName and inferred mime', () => {
        const src = attachmentToSource({
            collectionId: 'mail_messages',
            recordId: 'rec123',
            filename: 'report_aBc1234567.pdf',
        })
        expect(src).toEqual({
            collectionId: 'mail_messages',
            recordId: 'rec123',
            fileName: 'report_aBc1234567.pdf',
            displayName: 'report.pdf',
            mimeType: 'application/pdf',
            size: 0,
            thumbnailFileName: undefined,
        })
    })

    it('passes through an explicit thumbnail filename', () => {
        const src = attachmentToSource({
            collectionId: 'mail_messages',
            recordId: 'rec',
            filename: 'doc.pdf',
            thumbnailFilename: 'doc_thumb.jpg',
        })
        expect(src.thumbnailFileName).toBe('doc_thumb.jpg')
    })
})
