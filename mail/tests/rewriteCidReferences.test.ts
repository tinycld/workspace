import { describe, expect, it, vi } from 'vitest'

vi.mock('@tinycld/core/lib/pocketbase', () => ({
    pb: {
        files: {
            getURL: ({ id }: { id: string }, filename: string) =>
                `http://test.invalid/api/files/coll/${id}/${filename}`,
        },
    },
}))

const { rewriteCidReferences } = await import('../tinycld/mail/components/rewrite-cid-references')

const COLL = 'mail_messages'
const REC = 'rec1'

describe('rewriteCidReferences', () => {
    it('returns html unchanged when cidMap is null', () => {
        const html = '<img src="cid:foo">'
        expect(rewriteCidReferences(html, COLL, REC, null)).toBe(html)
    })

    it('returns html unchanged when cidMap is empty', () => {
        const html = '<img src="cid:foo">'
        expect(rewriteCidReferences(html, COLL, REC, {})).toBe(html)
    })

    it('rewrites a simple cid: reference', () => {
        const out = rewriteCidReferences('<img src="cid:foo">', COLL, REC, { foo: 'foo_xyz.jpg' })
        expect(out).toContain('http://test.invalid/api/files/coll/rec1/foo_xyz.jpg')
        expect(out).not.toContain('cid:foo')
    })

    it('matches when src is the only attribute (regression: was [^>]+)', () => {
        const out = rewriteCidReferences('<img src="cid:foo">', COLL, REC, { foo: 'foo_xyz.jpg' })
        expect(out).toContain('foo_xyz.jpg')
    })

    it('matches when other attributes precede src', () => {
        const out = rewriteCidReferences('<img alt="x" src="cid:foo">', COLL, REC, {
            foo: 'foo_xyz.jpg',
        })
        expect(out).toContain('foo_xyz.jpg')
    })

    it('matches when other attributes follow src', () => {
        const out = rewriteCidReferences('<img src="cid:foo" alt="x">', COLL, REC, {
            foo: 'foo_xyz.jpg',
        })
        expect(out).toContain('foo_xyz.jpg')
    })

    it('handles single-quoted src attributes', () => {
        const out = rewriteCidReferences("<img src='cid:foo'>", COLL, REC, { foo: 'foo_xyz.jpg' })
        expect(out).toContain('foo_xyz.jpg')
    })

    it('lowercases and trims angle brackets in cid', () => {
        const out = rewriteCidReferences('<img src="cid:FOO">', COLL, REC, { foo: 'foo_xyz.jpg' })
        expect(out).toContain('foo_xyz.jpg')
    })

    it('leaves unmatched cid: references alone', () => {
        const html = '<img src="cid:unknown">'
        const out = rewriteCidReferences(html, COLL, REC, { other: 'other.png' })
        expect(out).toBe(html)
    })

    it('rewrites multiple cid: references in one pass', () => {
        const html = '<p><img src="cid:a"></p><p><img src="cid:b"></p>'
        const out = rewriteCidReferences(html, COLL, REC, {
            a: 'a_xyz.jpg',
            b: 'b_xyz.png',
        })
        expect(out).toContain('a_xyz.jpg')
        expect(out).toContain('b_xyz.png')
        expect(out).not.toContain('cid:a')
        expect(out).not.toContain('cid:b')
    })

    it('does not rewrite non-img cid: occurrences', () => {
        const html = '<a href="cid:foo">link</a>'
        const out = rewriteCidReferences(html, COLL, REC, { foo: 'foo.jpg' })
        expect(out).toBe(html)
    })
})
