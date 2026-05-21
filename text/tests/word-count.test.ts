// WordCountBadge displays a live word count in the document header.
// The component itself is React Native (View / Text) styled with
// Uniwind and subscribes to a real Tiptap Editor instance, so we
// can't render it under vitest's node environment — same constraint
// as SaveStatusIndicator and ImportWarningBanner.
//
// What we DO lock here is the pure formatter / counter contract.
// `formatWordCount` and `formatCharacterCount` produce the visible
// chip text; `countWords` collapses arbitrary whitespace and returns
// the same number Tiptap's character-count extension would (had we
// chosen to ship it).
//
// Playwright covers the end-to-end "type three words → see 3 words"
// path; the unit tests below guard the formatter so a refactor that
// breaks pluralisation or the thousands separator fails locally
// before the e2e step.

import { describe, expect, it } from 'vitest'
import {
    countCharacters,
    countWords,
    formatCharacterCount,
    formatWordCount,
} from '../tinycld/text/lib/word-count'

describe('countWords', () => {
    it('returns 0 for an empty string', () => {
        expect(countWords('')).toBe(0)
    })

    it('returns 0 for a whitespace-only string', () => {
        // Trim collapses leading/trailing whitespace before the split
        // so a doc full of empty paragraphs (newlines only) reports 0.
        expect(countWords('   \n  \t  ')).toBe(0)
    })

    it('counts a single word with no whitespace', () => {
        expect(countWords('hello')).toBe(1)
    })

    it('counts words separated by single spaces', () => {
        expect(countWords('the quick brown fox')).toBe(4)
    })

    it('collapses runs of whitespace and newlines into a single boundary', () => {
        // Tiptap's `doc.textContent` concatenates paragraph text with
        // no separator, but inline runs and image placeholders insert
        // spaces — the counter must treat any whitespace run as one
        // boundary so "hello   world" and "hello\nworld" both report 2.
        expect(countWords('hello   world')).toBe(2)
        expect(countWords('hello\n\nworld')).toBe(2)
        expect(countWords('hello\tworld\nfoo')).toBe(3)
    })

    it('handles leading/trailing whitespace without inflating the count', () => {
        expect(countWords('  one two  ')).toBe(2)
    })

    it('counts hyphenated and apostrophised tokens as single words', () => {
        // Splitting on whitespace alone — matches Word / Pages / Docs
        // semantics where "well-known" is one word, not two.
        expect(countWords("don't worry about well-known issues")).toBe(5)
    })
})

describe('countCharacters', () => {
    it('returns 0 for an empty string', () => {
        expect(countCharacters('')).toBe(0)
    })

    it('counts characters including whitespace', () => {
        expect(countCharacters('hello world')).toBe(11)
    })
})

describe('formatWordCount', () => {
    it('uses the singular form for exactly 1 word', () => {
        expect(formatWordCount(1)).toBe('1 word')
    })

    it('uses the plural form for 0 words', () => {
        // "0 word" would read awkwardly in an empty document — the
        // plural is the safe default for everything other than 1.
        expect(formatWordCount(0)).toBe('0 words')
    })

    it('uses the plural form for any count above 1', () => {
        expect(formatWordCount(2)).toBe('2 words')
        expect(formatWordCount(42)).toBe('42 words')
    })

    it('formats thousands with a separator for readability', () => {
        // toLocaleString picks the runtime locale; the test environment
        // (Node, en-US) renders a comma. If a future CI runs under
        // another locale this test will document the assumption.
        expect(formatWordCount(1234)).toBe('1,234 words')
        expect(formatWordCount(1_000_000)).toBe('1,000,000 words')
    })
})

describe('formatCharacterCount', () => {
    it('uses the singular form for exactly 1 character', () => {
        expect(formatCharacterCount(1)).toBe('1 character')
    })

    it('uses the plural form for 0 and >1', () => {
        expect(formatCharacterCount(0)).toBe('0 characters')
        expect(formatCharacterCount(2)).toBe('2 characters')
    })

    it('formats thousands with a separator', () => {
        expect(formatCharacterCount(12_345)).toBe('12,345 characters')
    })
})

describe('integration contract', () => {
    // Document how WordCountBadge composes the helpers. The badge now
    // receives `wordCount` as a prop (sourced from toolbarState — web
    // computes via tiptapEditor.state.doc.textContent, native receives
    // it in the WebView's stateUpdate payload). It calls
    // formatWordCount(wordCount) and renders the resulting label, or
    // renders null when wordCount is null/undefined.
    it('a typical paragraph reports the expected word and character counts', () => {
        const text = 'The quick brown fox jumps over the lazy dog.'
        expect(countWords(text)).toBe(9)
        expect(countCharacters(text)).toBe(44)
        expect(formatWordCount(countWords(text))).toBe('9 words')
        expect(formatCharacterCount(countCharacters(text))).toBe('44 characters')
    })

    // WordCountBadge contract — locked here because the component
    // itself is React Native (View / Text) and can't be mounted under
    // vitest's node environment. Playwright covers the visible render
    // path; these assertions cover the helper composition the badge
    // performs.
    it('matches the badge label for an empty document (toolbarState.wordCount=0)', () => {
        expect(formatWordCount(0)).toBe('0 words')
    })

    it('matches the badge label for a one-word document', () => {
        expect(formatWordCount(1)).toBe('1 word')
    })

    it('matches the badge label for a large document with thousands separator', () => {
        expect(formatWordCount(1234)).toBe('1,234 words')
    })
})
