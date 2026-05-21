import { describe, expect, it } from 'vitest'
import { filterOwnAddresses, pickDefaultFrom } from '../tinycld/mail/hooks/defaultFromIdentity'
import type { SendableIdentity } from '../tinycld/mail/hooks/flattenSendableIdentities'

const personal: SendableIdentity = {
    mailboxId: 'mb1',
    mailboxDisplayName: 'Alice',
    primaryAddress: 'alice@acme.com',
    aliases: [{ id: 'a1', address: 'alice.smith@acme.com' }],
}
const support: SendableIdentity = {
    mailboxId: 'mb2',
    mailboxDisplayName: 'Support',
    primaryAddress: 'support@acme.com',
    aliases: [{ id: 'a2', address: 'help@acme.com' }],
}

describe('pickDefaultFrom', () => {
    it('returns first identity primary for new message', () => {
        expect(
            pickDefaultFrom({ mode: 'new', identities: [personal, support], replyToAddresses: [] })
        ).toEqual({
            mailboxId: 'mb1',
            aliasId: null,
        })
    })

    it('falls back to first identity when no reply matches', () => {
        expect(
            pickDefaultFrom({
                mode: 'reply',
                identities: [personal, support],
                replyToAddresses: ['ext@other.com'],
            })
        ).toEqual({ mailboxId: 'mb1', aliasId: null })
    })

    it('prefers mailbox primary when reply matches primary', () => {
        expect(
            pickDefaultFrom({
                mode: 'reply',
                identities: [personal, support],
                replyToAddresses: ['support@acme.com'],
            })
        ).toEqual({ mailboxId: 'mb2', aliasId: null })
    })

    it('matches alias when reply matches alias', () => {
        expect(
            pickDefaultFrom({
                mode: 'reply',
                identities: [personal, support],
                replyToAddresses: ['help@acme.com'],
            })
        ).toEqual({ mailboxId: 'mb2', aliasId: 'a2' })
    })

    it('prefers primary over alias when both appear', () => {
        expect(
            pickDefaultFrom({
                mode: 'reply',
                identities: [personal, support],
                replyToAddresses: ['help@acme.com', 'alice@acme.com'],
            })
        ).toEqual({ mailboxId: 'mb1', aliasId: null })
    })

    it('is case-insensitive', () => {
        expect(
            pickDefaultFrom({
                mode: 'reply',
                identities: [personal, support],
                replyToAddresses: ['Support@ACME.com'],
            })
        ).toEqual({ mailboxId: 'mb2', aliasId: null })
    })

    it('returns empty mailboxId when no identities', () => {
        expect(
            pickDefaultFrom({ mode: 'reply', identities: [], replyToAddresses: ['x@y.com'] })
        ).toEqual({
            mailboxId: '',
            aliasId: null,
        })
    })

    it('treats forward mode like reply for defaulting', () => {
        expect(
            pickDefaultFrom({
                mode: 'forward',
                identities: [personal, support],
                replyToAddresses: ['help@acme.com'],
            })
        ).toEqual({ mailboxId: 'mb2', aliasId: 'a2' })
    })
})

describe('filterOwnAddresses', () => {
    it('strips primary + aliases from recipient list', () => {
        const got = filterOwnAddresses({
            identity: support,
            recipients: [
                { name: 'External', email: 'ext@foo.com' },
                { name: 'Support', email: 'support@acme.com' },
                { name: 'Help', email: 'help@acme.com' },
            ],
        })
        expect(got).toEqual([{ name: 'External', email: 'ext@foo.com' }])
    })

    it('is case-insensitive on emails', () => {
        const got = filterOwnAddresses({
            identity: support,
            recipients: [{ name: 'Support', email: 'SUPPORT@acme.com' }],
        })
        expect(got).toEqual([])
    })

    it('returns the list unchanged when identity has no matches', () => {
        const got = filterOwnAddresses({
            identity: support,
            recipients: [{ name: 'External', email: 'ext@foo.com' }],
        })
        expect(got).toEqual([{ name: 'External', email: 'ext@foo.com' }])
    })
})

describe('pickDefaultFrom address extraction', () => {
    it('extracts bare address from display-name-prefixed input', () => {
        const got = pickDefaultFrom({
            mode: 'reply',
            identities: [personal, support],
            replyToAddresses: ['"Support Team" <support@acme.com>'],
        })
        expect(got).toEqual({ mailboxId: 'mb2', aliasId: null })
    })

    it('ignores empty strings in replyToAddresses', () => {
        const got = pickDefaultFrom({
            mode: 'reply',
            identities: [personal, support],
            replyToAddresses: ['', '   ', 'support@acme.com'],
        })
        expect(got).toEqual({ mailboxId: 'mb2', aliasId: null })
    })

    it('falls back when all replyToAddresses are unparseable', () => {
        const got = pickDefaultFrom({
            mode: 'reply',
            identities: [personal, support],
            replyToAddresses: ['', '   '],
        })
        expect(got).toEqual({ mailboxId: 'mb1', aliasId: null })
    })
})
