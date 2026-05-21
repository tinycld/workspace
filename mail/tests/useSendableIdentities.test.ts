import { describe, expect, it } from 'vitest'
import { flattenSendableIdentities } from '../tinycld/mail/hooks/flattenSendableIdentities'
import type { MailDomains, MailMailboxAliases, MailMailboxes } from '../tinycld/mail/types'

function mb(overrides: Partial<MailMailboxes>): MailMailboxes {
    return {
        id: 'mb1',
        address: 'alice',
        domain: 'd1',
        display_name: 'Alice',
        name: 'Acme',
        type: 'personal',
        created: '2024-01-01T00:00:00Z',
        updated: '2024-01-01T00:00:00Z',
        ...overrides,
    }
}

function dn(id: string, domain: string): MailDomains {
    return {
        id,
        domain,
        org: 'o',
        verified: true,
        mx_verified: true,
        inbound_domain_verified: true,
        spf_verified: true,
        dkim_verified: true,
        return_path_verified: true,
        last_checked_at: '',
        verification_details: null,
        webhook_secret: '',
        created: '',
        updated: '',
    }
}

function al(id: string, mailbox: string, address: string): MailMailboxAliases {
    return {
        id,
        mailbox,
        address,
        created: '',
        updated: '',
    }
}

describe('flattenSendableIdentities', () => {
    it('includes mailbox primary + its aliases', () => {
        const got = flattenSendableIdentities(
            [mb({ id: 'mb1', address: 'alice', domain: 'd1' })],
            [al('a1', 'mb1', 'alice.smith')],
            [dn('d1', 'acme.com')]
        )
        expect(got).toHaveLength(1)
        expect(got[0].mailboxId).toBe('mb1')
        expect(got[0].primaryAddress).toBe('alice@acme.com')
        expect(got[0].aliases).toEqual([{ id: 'a1', address: 'alice.smith@acme.com' }])
    })

    it('groups aliases by their owning mailbox', () => {
        const got = flattenSendableIdentities(
            [
                mb({ id: 'mb1', address: 'alice', domain: 'd1' }),
                mb({
                    id: 'mb2',
                    address: 'support',
                    domain: 'd1',
                    type: 'shared',
                    display_name: 'Support',
                }),
            ],
            [al('a1', 'mb2', 'help')],
            [dn('d1', 'acme.com')]
        )
        expect(got.find(i => i.mailboxId === 'mb1')?.aliases).toEqual([])
        expect(got.find(i => i.mailboxId === 'mb2')?.aliases).toEqual([
            { id: 'a1', address: 'help@acme.com' },
        ])
    })

    it('falls back to address when display_name is empty', () => {
        const got = flattenSendableIdentities(
            [mb({ id: 'mb1', address: 'alice', display_name: '' })],
            [],
            [dn('d1', 'acme.com')]
        )
        expect(got[0].mailboxDisplayName).toBe('alice')
    })

    it('returns empty list when no mailboxes', () => {
        expect(flattenSendableIdentities([], [], [])).toEqual([])
    })

    it('ignores aliases whose mailbox is not in the input list', () => {
        const got = flattenSendableIdentities(
            [mb({ id: 'mb1', address: 'alice', domain: 'd1' })],
            [al('a1', 'mb2', 'help')],
            [dn('d1', 'acme.com')]
        )
        expect(got[0].aliases).toEqual([])
    })

    it('skips mailboxes whose domain is unknown', () => {
        const got = flattenSendableIdentities(
            [mb({ id: 'mb1', address: 'alice', domain: 'd_missing' })],
            [],
            []
        )
        expect(got).toEqual([])
    })
})
