import { describe, expect, it } from 'vitest'
import { detectTrigger, renderMentionsToText } from '../mention-input-helpers'

describe('detectTrigger', () => {
    it('returns null on an empty value', () => {
        expect(detectTrigger('', 0)).toBeNull()
    })

    it('detects @ at the start of the body', () => {
        const v = '@ali'
        expect(detectTrigger(v, 4)).toEqual({ atIndex: 0, caretIndex: 4, query: 'ali' })
    })

    it('detects @ after whitespace', () => {
        const v = 'hey @bob'
        expect(detectTrigger(v, 8)).toEqual({ atIndex: 4, caretIndex: 8, query: 'bob' })
    })

    it('does not trigger on @ inside a word (e.g. email)', () => {
        const v = 'mail user@example.com'
        // caret right after the @
        expect(detectTrigger(v, 10)).toBeNull()
        // caret in the middle of the domain
        expect(detectTrigger(v, 18)).toBeNull()
    })

    it('does not trigger when the @-query already contains whitespace', () => {
        const v = '@ali bob'
        // caret right after the space — the query has ended, no popover.
        expect(detectTrigger(v, 8)).toBeNull()
    })

    it('returns empty query just after @ is typed', () => {
        const v = 'hello @'
        expect(detectTrigger(v, 7)).toEqual({ atIndex: 6, caretIndex: 7, query: '' })
    })

    it('returns null when the caret is past the end of the buffer', () => {
        expect(detectTrigger('@ali', 999)).toBeNull()
    })
})

describe('renderMentionsToText', () => {
    it('replaces tokens with @<displayName> when known', () => {
        const names = new Map([['uo_alice', 'Alice']])
        expect(renderMentionsToText('hi [[@uo_alice]]', names)).toBe('hi @Alice')
    })

    it('falls back to @<id> when the user is unknown', () => {
        expect(renderMentionsToText('hi [[@uo_ghost]]', new Map())).toBe('hi @uo_ghost')
    })

    it('handles multiple tokens', () => {
        const names = new Map([
            ['uo_alice', 'Alice'],
            ['uo_bob', 'Bob'],
        ])
        expect(renderMentionsToText('cc [[@uo_alice]] [[@uo_bob]]', names)).toBe('cc @Alice @Bob')
    })

    it('leaves text without tokens untouched', () => {
        expect(renderMentionsToText('plain body', new Map())).toBe('plain body')
    })
})
