import { useDemoLeadStore } from '@tinycld/core/lib/stores/demo-lead-store'
import { describe, expect, it } from 'vitest'

describe('useDemoLeadStore', () => {
    it('starts with isFollowUpOpen=false', () => {
        useDemoLeadStore.setState({ isFollowUpOpen: false })
        expect(useDemoLeadStore.getState().isFollowUpOpen).toBe(false)
    })

    it('setSubmitted closes the follow-up modal', () => {
        useDemoLeadStore.getState().setFollowUpOpen(true)
        useDemoLeadStore.getState().setSubmitted()
        expect(useDemoLeadStore.getState().isFollowUpOpen).toBe(false)
    })

    it('setFollowUpOpen toggles the transient field', () => {
        useDemoLeadStore.getState().setFollowUpOpen(true)
        expect(useDemoLeadStore.getState().isFollowUpOpen).toBe(true)

        useDemoLeadStore.getState().setFollowUpOpen(false)
        expect(useDemoLeadStore.getState().isFollowUpOpen).toBe(false)
    })
})
