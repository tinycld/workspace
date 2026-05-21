// Unit tests for the slash-menu command palette. Covers the pure
// pieces: the command list pin (so an accidental import re-shuffle
// can't quietly change what users see) and the case-insensitive
// label/keyword filter. The Tiptap-suggestion-plugin wiring and the
// popover UI live in Playwright; they exercise a live editor that's
// too heavy for vitest.

import { describe, expect, it } from 'vitest'
import {
    filterSlashMenuCommands,
    SLASH_MENU_COMMANDS,
} from '../tinycld/text/lib/editor/slash-menu-commands'

describe('SLASH_MENU_COMMANDS', () => {
    it('exposes the v1 command set in the documented order', () => {
        // Pin the count AND the identity of each entry so a refactor
        // can't quietly drop "Horizontal rule" or reorder "Quote"
        // before "Code block" without flagging the regression.
        expect(SLASH_MENU_COMMANDS.map(c => c.id)).toEqual([
            'heading-1',
            'heading-2',
            'heading-3',
            'bullet-list',
            'numbered-list',
            'quote',
            'code-block',
            'table',
            'image',
            'horizontal-rule',
        ])
    })

    it('pins the human-readable label for every command', () => {
        // The label is what shows in the popover. Anchor it so the
        // copy doesn't drift without notice (e.g. "Code block" → "Code"
        // is a real downgrade in scannability).
        const byId = Object.fromEntries(SLASH_MENU_COMMANDS.map(c => [c.id, c.label]))
        expect(byId).toEqual({
            'heading-1': 'Heading 1',
            'heading-2': 'Heading 2',
            'heading-3': 'Heading 3',
            'bullet-list': 'Bullet list',
            'numbered-list': 'Numbered list',
            quote: 'Quote',
            'code-block': 'Code block',
            table: 'Table',
            image: 'Image',
            'horizontal-rule': 'Horizontal rule',
        })
    })

    it('binds a run() handler to every entry', () => {
        for (const cmd of SLASH_MENU_COMMANDS) {
            expect(cmd.run).toBeTypeOf('function')
        }
    })

    it('exposes a string iconName for every entry (wire-shape for native)', () => {
        // The bridge render strategy serializes commands across the
        // WebView JSON bus and substitutes the Lucide ref with this
        // iconName, which the host resolves back via
        // slash-menu-icon-lookup. A null/missing iconName here would
        // render the popover with a blank icon slot on native.
        for (const cmd of SLASH_MENU_COMMANDS) {
            expect(cmd.iconName, `command=${cmd.id}`).toBeTypeOf('string')
            expect(cmd.iconName.length, `command=${cmd.id}`).toBeGreaterThan(0)
        }
    })

    // The cmd.icon LucideIcon ref was removed in favor of cmd.iconName
    // (a string the host-side popover maps to a LucideIcon via
    // slash-menu-icon-lookup). Keeping SLASH_MENU_COMMANDS lucide-free
    // is what lets it be consumed inside the WebView bundle without
    // dragging react-native into esbuild. Icon-rendering coverage
    // lives in the Playwright spec.
})

describe('filterSlashMenuCommands', () => {
    it('returns the full list for an empty query', () => {
        expect(filterSlashMenuCommands('').map(c => c.id)).toEqual(
            SLASH_MENU_COMMANDS.map(c => c.id)
        )
    })

    it('returns the full list for a whitespace-only query', () => {
        expect(filterSlashMenuCommands('   ').map(c => c.id)).toEqual(
            SLASH_MENU_COMMANDS.map(c => c.id)
        )
    })

    it('does not mutate the source list', () => {
        // filterSlashMenuCommands('') returns a copy; mutating the
        // returned array must not leak back into SLASH_MENU_COMMANDS.
        // A subtle .slice() vs return-by-reference bug would only show
        // up after the menu has been opened once and the popover
        // mutates state on the array (e.g. reorder, splice).
        const out = filterSlashMenuCommands('')
        expect(out).not.toBe(SLASH_MENU_COMMANDS)
        out.length = 0
        expect(SLASH_MENU_COMMANDS.length).toBeGreaterThan(0)
    })

    it('narrows to all three headings on "h"', () => {
        const out = filterSlashMenuCommands('h').map(c => c.id)
        // "h" matches "Heading 1/2/3" and also matches several keyword
        // entries; we assert the headings are all included rather than
        // the result is exactly those three — keywords like ['header']
        // on the three heading entries are part of the contract.
        expect(out).toContain('heading-1')
        expect(out).toContain('heading-2')
        expect(out).toContain('heading-3')
    })

    it('narrows to only the headings on "head"', () => {
        // "head" no longer matches other commands' labels/keywords, so
        // the result is exactly the heading trio.
        const out = filterSlashMenuCommands('head').map(c => c.id)
        expect(out).toEqual(['heading-1', 'heading-2', 'heading-3'])
    })

    it('matches the code-block entry on "code"', () => {
        const out = filterSlashMenuCommands('code').map(c => c.id)
        expect(out).toEqual(['code-block'])
    })

    it('matches the h1 shorthand keyword', () => {
        // "h1" isn't in any label; the entry advertises it via the
        // keywords array. Verify the keyword path engages.
        const out = filterSlashMenuCommands('h1').map(c => c.id)
        expect(out).toEqual(['heading-1'])
    })

    it('is case-insensitive', () => {
        expect(filterSlashMenuCommands('TABLE').map(c => c.id)).toEqual(['table'])
        expect(filterSlashMenuCommands('Quote').map(c => c.id)).toEqual(['quote'])
        expect(filterSlashMenuCommands('IMAGE').map(c => c.id)).toEqual(['image'])
    })

    it('returns an empty list when nothing matches', () => {
        expect(filterSlashMenuCommands('xyzzy')).toEqual([])
    })
})
