import { beforeEach, describe, expect, it } from 'vitest'
import { useAttachmentPreviewStore } from '../tinycld/mail/stores/attachment-preview-store'

function reset() {
    useAttachmentPreviewStore.setState({ active: null })
}

describe('attachment-preview-store', () => {
    beforeEach(reset)

    it('starts with no active attachment', () => {
        expect(useAttachmentPreviewStore.getState().active).toBeNull()
    })

    it('open() sets active to { messageId, fileName }', () => {
        useAttachmentPreviewStore.getState().open('m1', 'invoice.pdf')
        expect(useAttachmentPreviewStore.getState().active).toEqual({
            messageId: 'm1',
            fileName: 'invoice.pdf',
        })
    })

    it('close() clears active', () => {
        useAttachmentPreviewStore.getState().open('m1', 'a.pdf')
        useAttachmentPreviewStore.getState().close()
        expect(useAttachmentPreviewStore.getState().active).toBeNull()
    })

    it('setActive() replaces the current value', () => {
        useAttachmentPreviewStore.getState().open('m1', 'a.pdf')
        useAttachmentPreviewStore.getState().setActive({ messageId: 'm2', fileName: 'b.pdf' })
        expect(useAttachmentPreviewStore.getState().active).toEqual({
            messageId: 'm2',
            fileName: 'b.pdf',
        })
    })

    it('setActive(null) is equivalent to close', () => {
        useAttachmentPreviewStore.getState().open('m1', 'a.pdf')
        useAttachmentPreviewStore.getState().setActive(null)
        expect(useAttachmentPreviewStore.getState().active).toBeNull()
    })
})
