// Phase 1 verifier: markdownToPM + pmToMarkdown cover the supported
// node/mark subset and stay byte-stable through a full md → pm → md
// round-trip. These tests guard the contract between the editor schema
// and the clipboard import / .md export surfaces.

import { describe, expect, it } from 'vitest'
import { markdownToPM, markdownToPMBlocks } from '../tinycld/text/lib/markdown/md-to-pm'
import { pmToMarkdown } from '../tinycld/text/lib/markdown/pm-to-md'
import {
    MARK_BOLD,
    MARK_CODE,
    MARK_ITALIC,
    MARK_LINK,
    NODE_BLOCKQUOTE,
    NODE_BULLET_LIST,
    NODE_CODE_BLOCK,
    NODE_DOC,
    NODE_HEADING,
    NODE_IMAGE,
    NODE_LIST_ITEM,
    NODE_ORDERED_LIST,
    NODE_PAGE_BREAK,
    NODE_PARAGRAPH,
    NODE_TABLE,
    NODE_TABLE_CELL,
    NODE_TABLE_ROW,
    NODE_TEXT,
    type PMNode,
} from '../tinycld/text/lib/markdown/types'

describe('markdownToPM — empty input', () => {
    it('returns an empty doc for an empty string', () => {
        expect(markdownToPM('')).toEqual({ type: NODE_DOC, content: [] })
    })

    it('pmToMarkdown of an empty doc returns just a newline', () => {
        expect(pmToMarkdown({ type: NODE_DOC, content: [] })).toBe('\n')
    })
})

describe('markdownToPM — paragraph with inline marks', () => {
    it('parses bold / italic / code / link into a single paragraph', () => {
        const doc = markdownToPM(
            'Hello **bold** and *italic* and `code` and [link](https://example.com).'
        )
        expect(doc.type).toBe(NODE_DOC)
        const para = doc.content?.[0]
        expect(para?.type).toBe(NODE_PARAGRAPH)
        const kids = para?.content ?? []

        // Mark positions across the kids array — text/bold/text/italic/text/code/text/link/text
        const findFirst = (markType: string) =>
            kids.find(n => n.marks?.some(m => m.type === markType))

        expect(findFirst(MARK_BOLD)?.text).toBe('bold')
        expect(findFirst(MARK_ITALIC)?.text).toBe('italic')
        expect(findFirst(MARK_CODE)?.text).toBe('code')
        const linkNode = findFirst(MARK_LINK)
        expect(linkNode?.text).toBe('link')
        const linkMark = linkNode?.marks?.find(m => m.type === MARK_LINK)
        expect(linkMark?.attrs?.href).toBe('https://example.com')
    })
})

describe('markdownToPM — code-inline exclusivity', () => {
    // The PM `code` mark in StarterKit is exclusive (`excludes: '_'`), so
    // emitting a text node that carries both `link` and `code` makes
    // insertContent reject the entire doc with "Invalid collection of
    // marks for node text: link,code". The parser drops competing marks
    // on code-inline text so the PM JSON it produces is always insertable.
    it('drops surrounding link mark from code inside a link', () => {
        const doc = markdownToPM('A [pre `code` post](https://example.com) tail.')
        const para = doc.content?.[0]
        const kids = para?.content ?? []
        const codeNode = kids.find(n => n.marks?.some(m => m.type === MARK_CODE))
        expect(codeNode?.text).toBe('code')
        expect(codeNode?.marks).toHaveLength(1)
        expect(codeNode?.marks?.[0]?.type).toBe(MARK_CODE)
    })

    it('drops surrounding bold/italic marks from code', () => {
        const doc = markdownToPM('A **bold and `code` together** tail.')
        const para = doc.content?.[0]
        const kids = para?.content ?? []
        const codeNode = kids.find(n => n.marks?.some(m => m.type === MARK_CODE))
        expect(codeNode?.marks).toHaveLength(1)
        expect(codeNode?.marks?.[0]?.type).toBe(MARK_CODE)
    })
})

describe('markdownToPM — heading levels', () => {
    it('captures level 1, 2, 3 headings', () => {
        const doc = markdownToPM('# h1\n\n## h2\n\n### h3\n')
        const headings = doc.content ?? []
        expect(headings).toHaveLength(3)
        expect(headings[0]).toMatchObject({ type: NODE_HEADING, attrs: { level: 1 } })
        expect(headings[1]).toMatchObject({ type: NODE_HEADING, attrs: { level: 2 } })
        expect(headings[2]).toMatchObject({ type: NODE_HEADING, attrs: { level: 3 } })
        expect(headings[0].content?.[0]?.text).toBe('h1')
        expect(headings[1].content?.[0]?.text).toBe('h2')
        expect(headings[2].content?.[0]?.text).toBe('h3')
    })
})

describe('markdownToPM — bullet list with nested sub-list', () => {
    it('nests a sub-list inside a list item', () => {
        const doc = markdownToPM('- one\n  - one-a\n  - one-b\n- two\n')
        const list = doc.content?.[0]
        expect(list?.type).toBe(NODE_BULLET_LIST)
        const items = list?.content ?? []
        expect(items).toHaveLength(2)
        expect(items[0]?.type).toBe(NODE_LIST_ITEM)
        // The first item should contain a paragraph for "one" plus a
        // nested bulletList with two items.
        const inner = items[0]?.content ?? []
        const nested = inner.find(c => c.type === NODE_BULLET_LIST)
        expect(nested).toBeDefined()
        expect(nested?.content).toHaveLength(2)
    })
})

describe('markdownToPM — ordered list', () => {
    it('parses 1./2./3. into an orderedList with three items', () => {
        const doc = markdownToPM('1. one\n2. two\n3. three\n')
        const list = doc.content?.[0]
        expect(list?.type).toBe(NODE_ORDERED_LIST)
        expect(list?.content).toHaveLength(3)
        for (const item of list?.content ?? []) {
            expect(item.type).toBe(NODE_LIST_ITEM)
        }
    })
})

describe('markdownToPM — blockquote', () => {
    it('wraps content in a blockquote containing a paragraph', () => {
        const doc = markdownToPM('> quoted\n')
        const quote = doc.content?.[0]
        expect(quote?.type).toBe(NODE_BLOCKQUOTE)
        const para = quote?.content?.[0]
        expect(para?.type).toBe(NODE_PARAGRAPH)
        expect(para?.content?.[0]?.text).toBe('quoted')
    })
})

describe('markdownToPM — fenced code block', () => {
    it('keeps the raw code text without language attr', () => {
        const doc = markdownToPM('```\nconst x = 1\n```\n')
        const code = doc.content?.[0]
        expect(code?.type).toBe(NODE_CODE_BLOCK)
        expect(code?.content?.[0]?.text).toBe('const x = 1')
    })
})

describe('markdownToPM — pipe table', () => {
    it('builds a table > tableRow > tableCell tree from 2-col × 2-row markdown', () => {
        const md = '| a | b |\n| --- | --- |\n| c | d |\n'
        const doc = markdownToPM(md)
        const table = doc.content?.[0]
        expect(table?.type).toBe(NODE_TABLE)
        expect(table?.content).toHaveLength(2)
        for (const row of table?.content ?? []) {
            expect(row.type).toBe(NODE_TABLE_ROW)
            expect(row.content).toHaveLength(2)
            for (const cell of row.content ?? []) {
                expect(cell.type).toBe(NODE_TABLE_CELL)
            }
        }
    })

    it('pm → md → pm preserves the table shape', () => {
        const md = '| a | b |\n| --- | --- |\n| c | d |\n'
        const first = markdownToPM(md)
        const md2 = pmToMarkdown(first)
        const second = markdownToPM(md2)
        expect(second.content?.[0]?.type).toBe(NODE_TABLE)
        expect(second.content?.[0]?.content).toHaveLength(2)
    })
})

describe('markdownToPM — image inside paragraph', () => {
    it('places an image node inside a paragraph with src and alt', () => {
        const doc = markdownToPM('![alt](https://example.com/x.png)')
        const para = doc.content?.[0]
        expect(para?.type).toBe(NODE_PARAGRAPH)
        const img = para?.content?.find(c => c.type === NODE_IMAGE)
        expect(img?.attrs?.src).toBe('https://example.com/x.png')
        expect(img?.attrs?.alt).toBe('alt')
    })
})

describe('markdownToPM — thematic break', () => {
    it('renders --- as a pageBreak node', () => {
        const doc = markdownToPM('---\n')
        expect(doc.content?.[0]?.type).toBe(NODE_PAGE_BREAK)
    })
})

describe('markdownToPM — mixed marks', () => {
    it('produces a text node carrying both bold and italic for ***bold italic***', () => {
        const doc = markdownToPM('***bold italic***')
        const para = doc.content?.[0]
        const text = para?.content?.[0]
        expect(text?.type).toBe(NODE_TEXT)
        const types = (text?.marks ?? []).map(m => m.type).sort()
        expect(types).toEqual([MARK_BOLD, MARK_ITALIC].sort())
    })
})

describe('pmToMarkdown — round-trip stability on a mixed tree', () => {
    it('md(pm(md(pm))) === md(pm)', () => {
        const tree: PMNode = {
            type: NODE_DOC,
            content: [
                {
                    type: NODE_HEADING,
                    attrs: { level: 1 },
                    content: [{ type: NODE_TEXT, text: 'Title' }],
                },
                {
                    type: NODE_PARAGRAPH,
                    content: [
                        { type: NODE_TEXT, text: 'Hello ' },
                        { type: NODE_TEXT, text: 'world', marks: [{ type: MARK_BOLD }] },
                        { type: NODE_TEXT, text: '.' },
                    ],
                },
                {
                    type: NODE_BULLET_LIST,
                    content: [
                        {
                            type: NODE_LIST_ITEM,
                            content: [
                                {
                                    type: NODE_PARAGRAPH,
                                    content: [{ type: NODE_TEXT, text: 'one' }],
                                },
                            ],
                        },
                        {
                            type: NODE_LIST_ITEM,
                            content: [
                                {
                                    type: NODE_PARAGRAPH,
                                    content: [{ type: NODE_TEXT, text: 'two' }],
                                },
                            ],
                        },
                    ],
                },
                {
                    type: NODE_CODE_BLOCK,
                    content: [{ type: NODE_TEXT, text: 'const y = 2' }],
                },
                {
                    type: NODE_TABLE,
                    content: [
                        {
                            type: NODE_TABLE_ROW,
                            content: [
                                {
                                    type: NODE_TABLE_CELL,
                                    content: [
                                        {
                                            type: NODE_PARAGRAPH,
                                            content: [{ type: NODE_TEXT, text: 'a' }],
                                        },
                                    ],
                                },
                                {
                                    type: NODE_TABLE_CELL,
                                    content: [
                                        {
                                            type: NODE_PARAGRAPH,
                                            content: [{ type: NODE_TEXT, text: 'b' }],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            type: NODE_TABLE_ROW,
                            content: [
                                {
                                    type: NODE_TABLE_CELL,
                                    content: [
                                        {
                                            type: NODE_PARAGRAPH,
                                            content: [{ type: NODE_TEXT, text: 'c' }],
                                        },
                                    ],
                                },
                                {
                                    type: NODE_TABLE_CELL,
                                    content: [
                                        {
                                            type: NODE_PARAGRAPH,
                                            content: [{ type: NODE_TEXT, text: 'd' }],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
                {
                    type: NODE_PARAGRAPH,
                    content: [
                        {
                            type: NODE_IMAGE,
                            attrs: { src: 'https://example.com/x.png', alt: 'alt' },
                        },
                    ],
                },
                { type: NODE_PAGE_BREAK },
            ],
        }

        const first = pmToMarkdown(tree)
        const reparsed = markdownToPM(first)
        const second = pmToMarkdown(reparsed)
        expect(second).toBe(first)
    })
})

describe('markdownToPM — unknown block degrades gracefully', () => {
    it('does not throw on a raw HTML block', () => {
        expect(() => markdownToPM('<div>x</div>\n')).not.toThrow()
        const doc = markdownToPM('<div>x</div>\n')
        expect(doc.type).toBe(NODE_DOC)
        // We tolerate any shape — paragraph carrying the literal HTML is
        // the documented behaviour, but the important assertion is "no
        // crash" so we leave the exact shape unverified.
        expect(Array.isArray(doc.content)).toBe(true)
    })
})

describe('markdownToPMBlocks — source attribution', () => {
    it('returns an empty array for empty input', () => {
        expect(markdownToPMBlocks('')).toEqual([])
    })

    it('attaches the exact line range to each top-level block', () => {
        const md = '# Title\n\nFirst paragraph.\n\nSecond paragraph.\n'
        const blocks = markdownToPMBlocks(md)
        expect(blocks).toHaveLength(3)
        expect(blocks[0].block.type).toBe(NODE_HEADING)
        expect(blocks[0].source).toBe('# Title')
        expect(blocks[1].block.type).toBe(NODE_PARAGRAPH)
        expect(blocks[1].source).toBe('First paragraph.')
        expect(blocks[2].block.type).toBe(NODE_PARAGRAPH)
        expect(blocks[2].source).toBe('Second paragraph.')
    })

    it('captures a whole list as one block with its full source', () => {
        const md = '- one\n- two\n- three\n'
        const blocks = markdownToPMBlocks(md)
        expect(blocks).toHaveLength(1)
        expect(blocks[0].block.type).toBe(NODE_BULLET_LIST)
        expect(blocks[0].source).toBe('- one\n- two\n- three')
    })

    it('captures a fenced code block including its source fences', () => {
        const md = '```\nconst x = 1\n```\n'
        const blocks = markdownToPMBlocks(md)
        expect(blocks).toHaveLength(1)
        expect(blocks[0].block.type).toBe(NODE_CODE_BLOCK)
        expect(blocks[0].source).toBe('```\nconst x = 1\n```')
    })

    it('keeps blocks in source order through mixed content', () => {
        const md = '# H\n\npara\n\n- a\n- b\n\n```\nfn()\n```\n\n---\n'
        const blocks = markdownToPMBlocks(md)
        const types = blocks.map(b => b.block.type)
        expect(types).toEqual([
            NODE_HEADING,
            NODE_PARAGRAPH,
            NODE_BULLET_LIST,
            NODE_CODE_BLOCK,
            NODE_PAGE_BREAK,
        ])
    })
})
