import { describe, expect, it } from 'vitest'
import {
    filterAndGroupMailboxes,
    type MailboxListItem,
} from '../tinycld/mail/hooks/filterMailboxes'

function item(overrides: Partial<MailboxListItem> = {}): MailboxListItem {
    return {
        id: 'mb1',
        address: 'support',
        domainName: 'tinycld.org',
        displayName: 'Support Team',
        type: 'shared',
        memberCount: 1,
        aliasCount: 0,
        memberNames: ['Nathan Stitt'],
        memberEmails: ['nathan@tinycld.org'],
        aliasAddresses: [],
        ...overrides,
    }
}

describe('filterAndGroupMailboxes', () => {
    it('returns all items when query is empty and filter is all', () => {
        const a = item({ id: 'a', type: 'shared' })
        const b = item({ id: 'b', type: 'personal', address: 'nathan' })
        const got = filterAndGroupMailboxes([a, b], { query: '', type: 'all' })
        expect(got.shared.map(m => m.id)).toEqual(['a'])
        expect(got.personal.map(m => m.id)).toEqual(['b'])
        expect(got.totals).toEqual({ all: 2, shared: 1, personal: 1 })
    })

    it('filters by type=shared', () => {
        const a = item({ id: 'a', type: 'shared' })
        const b = item({ id: 'b', type: 'personal' })
        const got = filterAndGroupMailboxes([a, b], { query: '', type: 'shared' })
        expect(got.shared.map(m => m.id)).toEqual(['a'])
        expect(got.personal).toEqual([])
    })

    it('filters by type=personal', () => {
        const a = item({ id: 'a', type: 'shared' })
        const b = item({ id: 'b', type: 'personal' })
        const got = filterAndGroupMailboxes([a, b], { query: '', type: 'personal' })
        expect(got.shared).toEqual([])
        expect(got.personal.map(m => m.id)).toEqual(['b'])
    })

    it('matches query against primary address', () => {
        const a = item({
            id: 'a',
            address: 'support',
            displayName: 'Help Desk',
            memberNames: [],
            memberEmails: [],
        })
        const b = item({
            id: 'b',
            address: 'billing',
            displayName: 'Help Desk',
            memberNames: [],
            memberEmails: [],
        })
        const got = filterAndGroupMailboxes([a, b], { query: 'sup', type: 'all' })
        expect(got.shared.map(m => m.id)).toEqual(['a'])
    })

    it('matches query against display name (case-insensitive)', () => {
        const a = item({ id: 'a', displayName: 'Support Team' })
        const b = item({ id: 'b', displayName: 'Billing' })
        const got = filterAndGroupMailboxes([a, b], { query: 'TEAM', type: 'all' })
        expect(got.shared.map(m => m.id)).toEqual(['a'])
    })

    it('matches query against member name', () => {
        const a = item({ id: 'a', memberNames: ['Rachel Tan'] })
        const b = item({ id: 'b', memberNames: ['Jamie'] })
        const got = filterAndGroupMailboxes([a, b], { query: 'rachel', type: 'all' })
        expect(got.shared.map(m => m.id)).toEqual(['a'])
    })

    it('matches query against member email', () => {
        const a = item({ id: 'a', memberEmails: ['rachel@tinycld.org'] })
        const b = item({ id: 'b', memberEmails: ['jamie@tinycld.org'] })
        const got = filterAndGroupMailboxes([a, b], { query: 'rachel@', type: 'all' })
        expect(got.shared.map(m => m.id)).toEqual(['a'])
    })

    it('matches query against alias address', () => {
        const a = item({ id: 'a', aliasAddresses: ['help'] })
        const b = item({ id: 'b' })
        const got = filterAndGroupMailboxes([a, b], { query: 'help', type: 'all' })
        expect(got.shared.map(m => m.id)).toEqual(['a'])
    })

    it('sorts shared before personal regardless of input order (personal first case)', () => {
        const p = item({ id: 'p', type: 'personal', address: 'zeta' })
        const s = item({ id: 's', type: 'shared', address: 'alpha' })
        const got = filterAndGroupMailboxes([p, s], { query: '', type: 'all' })
        expect(got.shared.map(m => m.id)).toEqual(['s'])
        expect(got.personal.map(m => m.id)).toEqual(['p'])
    })

    it('sorts within each group alphabetically by address', () => {
        const a = item({ id: 'a', address: 'zeta', type: 'shared' })
        const b = item({ id: 'b', address: 'alpha', type: 'shared' })
        const got = filterAndGroupMailboxes([a, b], { query: '', type: 'all' })
        expect(got.shared.map(m => m.id)).toEqual(['b', 'a'])
    })

    it('totals always reflect the full dataset, not the filtered slice', () => {
        const a = item({ id: 'a', type: 'shared' })
        const b = item({ id: 'b', type: 'personal' })
        const got = filterAndGroupMailboxes([a, b], { query: 'support', type: 'all' })
        expect(got.totals).toEqual({ all: 2, shared: 1, personal: 1 })
    })
})
