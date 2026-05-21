import { beforeEach, describe, expect, it } from 'vitest'
import { useAttachmentStripStore } from '../tinycld/mail/stores/attachment-strip-store'

function reset() {
    useAttachmentStripStore.setState({ threadId: null, expanded: false })
}

describe('attachment-strip-store', () => {
    beforeEach(reset)

    it('expand() sets expanded to true', () => {
        useAttachmentStripStore.getState().expand()
        expect(useAttachmentStripStore.getState().expanded).toBe(true)
    })

    it('collapse() sets expanded to false', () => {
        useAttachmentStripStore.getState().expand()
        useAttachmentStripStore.getState().collapse()
        expect(useAttachmentStripStore.getState().expanded).toBe(false)
    })

    it('toggle() flips expanded', () => {
        const { toggle } = useAttachmentStripStore.getState()
        toggle()
        expect(useAttachmentStripStore.getState().expanded).toBe(true)
        toggle()
        expect(useAttachmentStripStore.getState().expanded).toBe(false)
    })

    it('resetForThread sets threadId and expanded=false on first call', () => {
        useAttachmentStripStore.getState().resetForThread('a')
        expect(useAttachmentStripStore.getState().threadId).toBe('a')
        expect(useAttachmentStripStore.getState().expanded).toBe(false)
    })

    it('resetForThread to a NEW thread resets expanded', () => {
        useAttachmentStripStore.getState().resetForThread('a')
        useAttachmentStripStore.getState().expand()
        useAttachmentStripStore.getState().resetForThread('b')
        expect(useAttachmentStripStore.getState().threadId).toBe('b')
        expect(useAttachmentStripStore.getState().expanded).toBe(false)
    })

    it('resetForThread to the SAME thread is a no-op', () => {
        useAttachmentStripStore.getState().resetForThread('a')
        useAttachmentStripStore.getState().expand()
        useAttachmentStripStore.getState().resetForThread('a')
        expect(useAttachmentStripStore.getState().threadId).toBe('a')
        expect(useAttachmentStripStore.getState().expanded).toBe(true)
    })
})
