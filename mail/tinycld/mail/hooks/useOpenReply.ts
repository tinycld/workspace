import { useCallback } from 'react'
import { useAttachmentStripStore } from '../stores/attachment-strip-store'
import { type ReplyContext, useCompose } from './useComposeState'

export function useOpenReply() {
    const { openReply } = useCompose()
    return useCallback(
        (context: ReplyContext) => {
            useAttachmentStripStore.getState().collapse()
            openReply(context)
        },
        [openReply]
    )
}
