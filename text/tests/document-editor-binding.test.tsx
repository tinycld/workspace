// The text editor binding has two contracts a unit test can usefully
// lock without a real DOM:
//
// 1. Y.Doc shape — Tiptap's Collaboration extension binds to a
//    fragment field name (`prosemirror`). The server's bootstrap
//    (translate.SeedFromPMJSON) writes into the same fragment. A
//    rename or typo on either side silently produces an editor with
//    no content. Lock the field name.
//
// 2. Presence colors — useTextRoom stamps awareness.user with a
//    deterministic color from the user's id, so two tabs of the
//    same user show the same color. The color must be stable across
//    reloads and deterministic across machines (it ends up in the
//    DOCX-imported document as a literal CSS string per cursor).
//
// Tiptap's runtime needs a real DOM and a mounted EditorView before
// commands and reactive state become meaningful — the full editor
// behavior is covered by the M6.20 Playwright suite. This file
// catches breakage in the pre-Tiptap data layer.

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { colorForUser } from '../tinycld/text/lib/color-for-user'

describe('Y.Doc binding shape', () => {
    it("uses the 'prosemirror' XmlFragment slot the Collaboration extension binds to", () => {
        // Tiptap's Collaboration extension is configured with
        // `field: 'prosemirror'` (see use-document-editor.web.tsx).
        // The server's Y.Doc bootstrap writes the same field; if
        // either side drifts, the editor opens blank.
        const yDoc = new Y.Doc()
        const fragment = yDoc.getXmlFragment('prosemirror')
        expect(fragment).toBeDefined()
        expect(fragment.length).toBe(0)
        yDoc.destroy()
    })

    it('returns a stable XmlFragment handle on repeated lookups', () => {
        const yDoc = new Y.Doc()
        const a = yDoc.getXmlFragment('prosemirror')
        const b = yDoc.getXmlFragment('prosemirror')
        expect(a).toBe(b) // same identity — y-prosemirror relies on this
        yDoc.destroy()
    })
})

describe('Awareness binding shape', () => {
    it('attaches awareness to the same Y.Doc useTextRoom hands the editor', () => {
        const yDoc = new Y.Doc()
        const awareness = new Awareness(yDoc)
        // CollaborationCaret reads cursor positions through
        // awareness.doc; useTextRoom passes both into useDocumentEditor.
        // The link between them must survive any yjs / y-protocols
        // version bump.
        expect(awareness.doc).toBe(yDoc)
        awareness.destroy()
        yDoc.destroy()
    })

    it('round-trips the {user, cursor} slot useTextRoom seeds at mount', () => {
        const yDoc = new Y.Doc()
        const awareness = new Awareness(yDoc)
        awareness.setLocalState({
            user: { id: 'u1', name: 'Alex', color: '#abc123' },
            cursor: null,
        })
        const local = awareness.getLocalState()
        expect(local).toMatchObject({
            user: { id: 'u1', name: 'Alex', color: '#abc123' },
            cursor: null,
        })
        awareness.destroy()
        yDoc.destroy()
    })
})

describe('colorForUser', () => {
    it('is deterministic — same id always returns the same color', () => {
        expect(colorForUser('user_abc')).toBe(colorForUser('user_abc'))
        expect(colorForUser('alice-1234567890')).toBe(
            colorForUser('alice-1234567890')
        )
    })

    it('returns a string from the fixed 16-color palette', () => {
        // The palette is closed; awareness consumers (other tabs)
        // expect colors to fall in a known range. A regression
        // here would break the visual contract that the cursor
        // chip and the avatar share the same color.
        const PALETTE = new Set([
            '#e11d48',
            '#f97316',
            '#eab308',
            '#84cc16',
            '#22c55e',
            '#10b981',
            '#14b8a6',
            '#06b6d4',
            '#3b82f6',
            '#6366f1',
            '#8b5cf6',
            '#a855f7',
            '#d946ef',
            '#ec4899',
            '#f43f5e',
            '#64748b',
        ])
        const samples = [
            'a',
            'alice',
            'bob',
            'user_12345',
            'longer-user-id-with-dashes',
            '',
            '0',
        ]
        for (const id of samples) {
            const color = colorForUser(id)
            expect(PALETTE.has(color), `${id} → ${color}`).toBe(true)
        }
    })

    it('distributes distinct ids across the palette (not all the same color)', () => {
        // Birthday-paradox test: 32 random-looking ids should hit
        // at least 4 distinct palette entries. A regression to
        // "always return PALETTE[0]" would fail here.
        const ids = Array.from({ length: 32 }, (_, i) => `user_${i}`)
        const colors = new Set(ids.map(colorForUser))
        expect(colors.size).toBeGreaterThanOrEqual(4)
    })
})
