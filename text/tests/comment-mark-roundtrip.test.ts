// Round-trip test for the comment mark. The y-prosemirror binding
// reflects ProseMirror marks into a Y.XmlElement carrying the mark's
// HTML attributes; remote peers reconstruct the mark by re-parsing
// those attributes through the mark's parseHTML rules. If our
// renderHTML / parseHTML pair drops the `commentId` attribute, the
// mark survives a local transaction but vanishes the moment a peer
// applies the sync update.
//
// Rather than spin up two peer Y.Doc instances (which would pull in
// every layer of y-prosemirror), this test exercises the same
// contract directly through Tiptap's generateHTML/generateJSON:
//   - generateHTML(json, extensions) takes the same JSON shape Tiptap
//     produces from `editor.getJSON()` and renders it through every
//     extension's renderHTML, the same path y-prosemirror serializes
//     marks through on the wire.
//   - generateJSON(html, extensions) parses that HTML back through
//     every extension's parseHTML — the same path the remote peer
//     uses to reconstruct marks.
// If renderHTML/parseHTML drift apart on the commentId attribute,
// these tests fail; if they stay in sync, the Y.Doc round-trip is
// guaranteed by construction.

import { generateHTML, generateJSON } from '@tiptap/core'
import { Color } from '@tiptap/extension-color'
import Placeholder from '@tiptap/extension-placeholder'
import { TextStyle } from '@tiptap/extension-text-style'
import StarterKit from '@tiptap/starter-kit'
import { Window } from 'happy-dom'
import { beforeAll, describe, expect, it } from 'vitest'
import { CommentMark } from '../tinycld/text/lib/editor/comment-mark'

const extensions = [
    StarterKit.configure({ undoRedo: false, link: { openOnClick: false } }),
    TextStyle,
    Color,
    Placeholder.configure({ placeholder: '' }),
    CommentMark,
]

beforeAll(() => {
    const win = new Window()
    // Tiptap's generateHTML / generateJSON inspect a global `window`
    // (and follow window.document for DOM ops). Stake both on
    // globalThis so the helpers work outside a browser environment.
    const g = globalThis as unknown as { window?: unknown; document?: unknown }
    g.window = win
    g.document = win.document
})

describe('CommentMark JSON round-trip', () => {
    it('preserves commentId through generateHTML -> generateJSON', () => {
        const json = {
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    content: [
                        {
                            type: 'text',
                            text: 'anchored text',
                            marks: [
                                {
                                    type: 'tinycldComment',
                                    attrs: { commentId: 'cm_abc' },
                                },
                            ],
                        },
                    ],
                },
            ],
        }
        const html = generateHTML(json, extensions)
        expect(html).toContain('data-comment-id="cm_abc"')
        const reparsed = generateJSON(html, extensions)
        const found = JSON.stringify(reparsed)
        expect(found).toContain('"commentId":"cm_abc"')
        expect(found).toContain('"type":"tinycldComment"')
    })

    it('drops the mark when data-comment-id is missing', () => {
        const html = '<p><span class="tinycld-comment">no anchor</span></p>'
        const reparsed = generateJSON(html, extensions)
        const found = JSON.stringify(reparsed)
        expect(found).not.toContain('"tinycldComment"')
    })

    it('round-trips multiple distinct commentIds independently', () => {
        const json = {
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    content: [
                        {
                            type: 'text',
                            text: 'alpha',
                            marks: [{ type: 'tinycldComment', attrs: { commentId: 'first' } }],
                        },
                        { type: 'text', text: ' ' },
                        {
                            type: 'text',
                            text: 'beta',
                            marks: [{ type: 'tinycldComment', attrs: { commentId: 'second' } }],
                        },
                    ],
                },
            ],
        }
        const html = generateHTML(json, extensions)
        expect(html).toContain('data-comment-id="first"')
        expect(html).toContain('data-comment-id="second"')
        const reparsed = generateJSON(html, extensions)
        const found = JSON.stringify(reparsed)
        expect(found).toContain('"commentId":"first"')
        expect(found).toContain('"commentId":"second"')
    })
})
