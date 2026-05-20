import { create } from '@tinycld/core/lib/store'

interface DemoLeadState {
    /** Transient: is the banner-triggered follow-up modal open right now? */
    isFollowUpOpen: boolean

    /** Closes the follow-up modal after a successful submit. */
    setSubmitted: () => void
    setFollowUpOpen: (open: boolean) => void
}

export const useDemoLeadStore = create<DemoLeadState>()(set => ({
    isFollowUpOpen: false,
    setSubmitted: () => set({ isFollowUpOpen: false }),
    setFollowUpOpen: open => set({ isFollowUpOpen: open }),
}))
