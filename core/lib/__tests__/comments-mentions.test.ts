import { describe, expect, it } from 'vitest'
import { parseMentions } from '../comments'

describe('parseMentions', () => {
    it('returns [] for a body with no tokens', () => {
        expect(parseMentions('plain text, no mentions')).toEqual([])
        expect(parseMentions('')).toEqual([])
    })

    it('parses a single mention with its range', () => {
        const body = 'hey [[@user_org_abc]] please review'
        expect(parseMentions(body)).toEqual([
            { userOrgId: 'user_org_abc', range: { from: 4, to: 21 } },
        ])
    })

    it('parses multiple distinct mentions, in document order', () => {
        const body = '[[@alice]] cc [[@bob]] and [[@carol]]'
        expect(parseMentions(body).map(m => m.userOrgId)).toEqual(['alice', 'bob', 'carol'])
    })

    it('dedupes repeated mentions of the same user', () => {
        const body = '[[@alice]] [[@alice]] [[@alice]]'
        const mentions = parseMentions(body)
        expect(mentions).toHaveLength(1)
        // Range points at the first occurrence — later mentions are
        // dropped, matching the "one comment_mentions row per
        // (comment, user)" semantics in the mutations factory.
        expect(mentions[0]).toEqual({ userOrgId: 'alice', range: { from: 0, to: 10 } })
    })

    it('ignores malformed tokens', () => {
        // Single brackets, missing @, whitespace inside id — none parse.
        const body = '[@alice] [[alice]] [[@ no_spaces]] @alice'
        expect(parseMentions(body)).toEqual([])
    })

    it('accepts pbtsdb-style ids (letters, digits, underscore, dash)', () => {
        const body = '[[@usr_abc-123]] hi'
        expect(parseMentions(body)).toEqual([
            { userOrgId: 'usr_abc-123', range: { from: 0, to: 16 } },
        ])
    })

    it('handles mentions glued to surrounding text', () => {
        // The token is brackets-delimited so there's no whitespace
        // requirement either side.
        const body = 'ping[[@bob]]now'
        expect(parseMentions(body)).toEqual([{ userOrgId: 'bob', range: { from: 4, to: 12 } }])
    })
})
