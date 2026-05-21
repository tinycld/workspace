import { create } from '@tinycld/core/lib/store'
import type { ComposeMode, DraftContext, ReplyContext } from '../hooks/useComposeState'

interface ComposeStoreState {
    mode: ComposeMode
    replyContext: ReplyContext | null
    draftContext: DraftContext | null
    mailboxId: string
    aliasId: string | null
    open: () => void
    minimize: () => void
    maximize: () => void
    close: () => void
    openReply: (context: ReplyContext) => void
    openDraft: (context: DraftContext) => void
    setFromIdentity: (mailboxId: string, aliasId: string | null) => void
}

export const useComposeStore = create<ComposeStoreState>((set) => ({
    mode: 'closed',
    replyContext: null,
    draftContext: null,
    mailboxId: '',
    aliasId: null,
    open: () => set({ mode: 'open' }),
    minimize: () => set({ mode: 'minimized' }),
    maximize: () => set({ mode: 'maximized' }),
    close: () =>
        set({
            mode: 'closed',
            replyContext: null,
            draftContext: null,
            mailboxId: '',
            aliasId: null,
        }),
    openReply: (context) =>
        set({
            replyContext: context,
            mode: 'inline',
            mailboxId: context.mailboxId,
            aliasId: null,
        }),
    openDraft: (context) =>
        set({
            draftContext: context,
            replyContext: null,
            mode: 'open',
            mailboxId: context.mailboxId,
            aliasId: context.aliasId,
        }),
    setFromIdentity: (mailboxId, aliasId) => set({ mailboxId, aliasId }),
}))
