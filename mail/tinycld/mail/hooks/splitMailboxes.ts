import type { MailMailboxes } from '../types'

export interface MailboxesResult {
    personal: MailMailboxes | null
    shared: MailMailboxes[]
}

/**
 * Pure: given membership rows for the current user_org and the list of all
 * mailboxes in the org, return the user's personal mailbox and shared
 * mailboxes they belong to. Shared mailboxes are sorted by `created` ascending.
 */
export function splitMailboxes(memberUserOrgMailboxIds: string[], allMailboxes: MailMailboxes[]): MailboxesResult {
    const memberSet = new Set(memberUserOrgMailboxIds)
    const mine = allMailboxes.filter((mb) => memberSet.has(mb.id))
    const personal = mine.find((mb) => mb.type === 'personal') ?? null
    const shared = mine.filter((mb) => mb.type === 'shared').sort((a, b) => a.created.localeCompare(b.created))
    return { personal, shared }
}
