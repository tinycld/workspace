import type { MailThreadState } from '../types'

export function mergeSharedFolderStates(states: MailThreadState[], coMemberUserOrgIds: string[]): MailThreadState[] {
    const coMemberSet = new Set(coMemberUserOrgIds)
    const seen = new Set<string>()
    const merged: MailThreadState[] = []
    for (const s of states) {
        if (!coMemberSet.has(s.user_org)) continue
        if (seen.has(s.thread)) continue
        seen.add(s.thread)
        merged.push(s)
    }
    return merged
}
