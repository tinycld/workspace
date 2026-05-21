import { describe, expect, it } from 'vitest'
import { buildHelpSource, parseFrontmatter } from '../gen-help'

const DOC = `---
title: Composing a message
summary: Write and send mail
tags: [compose, draft]
order: 10
---

## To compose

Click **Compose**.
`

describe('parseFrontmatter', () => {
    it('extracts title/summary/tags/order and body', () => {
        const r = parseFrontmatter(DOC)
        expect(r.title).toBe('Composing a message')
        expect(r.summary).toBe('Write and send mail')
        expect(r.tags).toEqual(['compose', 'draft'])
        expect(r.order).toBe(10)
        expect(r.body.trim().startsWith('## To compose')).toBe(true)
    })
})

describe('buildHelpSource', () => {
    it('emits a HelpGroup[] with id = pkg:topic, sorted by order', () => {
        const src = buildHelpSource([
            {
                packageName: '@tinycld/mail',
                pkgSlug: 'mail',
                topics: [
                    {
                        topicId: 'b',
                        frontmatter: parseFrontmatter(
                            '---\ntitle: B\nsummary: s\norder: 2\n---\nx'
                        ),
                    },
                    {
                        topicId: 'a',
                        frontmatter: parseFrontmatter(
                            '---\ntitle: A\nsummary: s\norder: 1\n---\nx'
                        ),
                    },
                ],
            },
        ])
        expect(src).toContain('export const packageHelp')
        // order 1 (a) should appear before order 2 (b)
        expect(src.indexOf('"mail:a"')).toBeLessThan(src.indexOf('"mail:b"'))
    })
})
