import type { EditorCommands, EditorToolbarState } from '@tinycld/core/lib/editor/types'
import { describe, expect, it, vi } from 'vitest'
import {
    type ContextMenuItemId,
    buildDocumentContextMenu,
} from '../tinycld/text/components/document-context-menu-items'

function makeToolbarState(over: Partial<EditorToolbarState> = {}): EditorToolbarState {
    return {
        isBoldActive: false,
        isItalicActive: false,
        isUnderlineActive: false,
        isBulletListActive: false,
        isOrderedListActive: false,
        isBlockquoteActive: false,
        isLinkActive: false,
        currentLink: null,
        activeHeadingLevel: null,
        isInTable: false,
        selectionEmpty: true,
        ...over,
    }
}

function makeCommands(): EditorCommands {
    return {
        toggleBold: vi.fn(),
        toggleItalic: vi.fn(),
        toggleUnderline: vi.fn(),
        toggleBulletList: vi.fn(),
        toggleOrderedList: vi.fn(),
        toggleBlockquote: vi.fn(),
        toggleHeading: vi.fn(),
        setLink: vi.fn(),
        removeLink: vi.fn(),
        undo: vi.fn(),
        redo: vi.fn(),
        cut: vi.fn(),
        copy: vi.fn(),
        paste: vi.fn(),
        deleteSelection: vi.fn(),
        selectAll: vi.fn(),
        insertTable: vi.fn(),
        addRowBefore: vi.fn(),
        addRowAfter: vi.fn(),
        addColumnBefore: vi.fn(),
        addColumnAfter: vi.fn(),
        deleteRow: vi.fn(),
        deleteColumn: vi.fn(),
        deleteTable: vi.fn(),
    }
}

function collectIds(
    groups: ReturnType<typeof buildDocumentContextMenu>
): ContextMenuItemId[] {
    return groups.flatMap(g => g.rows.map(r => r.id))
}

function findRow(groups: ReturnType<typeof buildDocumentContextMenu>, id: ContextMenuItemId) {
    for (const group of groups) {
        const row = group.rows.find(r => r.id === id)
        if (row) return row
    }
    throw new Error(`row ${id} not found`)
}

describe('buildDocumentContextMenu', () => {
    it('shows clipboard + link items when not in a table', () => {
        const groups = buildDocumentContextMenu({
            commands: makeCommands(),
            toolbarState: makeToolbarState(),
            editable: true,
            onRequestInsertLink: () => undefined,
        })

        expect(collectIds(groups)).toEqual([
            'cut',
            'copy',
            'paste',
            'delete',
            'select-all',
            'insert-link',
        ])
    })

    it('appends table operations when the caret is inside a table', () => {
        const groups = buildDocumentContextMenu({
            commands: makeCommands(),
            toolbarState: makeToolbarState({ isInTable: true }),
            editable: true,
            onRequestInsertLink: () => undefined,
        })

        expect(collectIds(groups)).toContain('table-insert-row-above')
        expect(collectIds(groups)).toContain('table-delete-table')
        // Table group is labeled so the user sees a header above it.
        const tableGroup = groups.find(g => g.label === 'Table')
        expect(tableGroup).toBeDefined()
    })

    it('disables Cut/Copy/Delete when there is no selection', () => {
        const groups = buildDocumentContextMenu({
            commands: makeCommands(),
            toolbarState: makeToolbarState({ selectionEmpty: true }),
            editable: true,
            onRequestInsertLink: () => undefined,
        })

        expect(findRow(groups, 'cut').isDisabled).toBe(true)
        expect(findRow(groups, 'copy').isDisabled).toBe(true)
        expect(findRow(groups, 'delete').isDisabled).toBe(true)
        // Paste is independent of selection — only requires editable.
        expect(findRow(groups, 'paste').isDisabled).toBe(false)
        // Select all is always available.
        expect(findRow(groups, 'select-all').isDisabled).toBe(false)
    })

    it('enables Cut/Copy/Delete when there is a selection', () => {
        const groups = buildDocumentContextMenu({
            commands: makeCommands(),
            toolbarState: makeToolbarState({ selectionEmpty: false }),
            editable: true,
            onRequestInsertLink: () => undefined,
        })

        expect(findRow(groups, 'cut').isDisabled).toBe(false)
        expect(findRow(groups, 'copy').isDisabled).toBe(false)
        expect(findRow(groups, 'delete').isDisabled).toBe(false)
    })

    it('disables every editing action when read-only, but allows Copy + Select all', () => {
        const groups = buildDocumentContextMenu({
            commands: makeCommands(),
            toolbarState: makeToolbarState({ selectionEmpty: false, isInTable: true }),
            editable: false,
            onRequestInsertLink: () => undefined,
        })

        expect(findRow(groups, 'cut').isDisabled).toBe(true)
        expect(findRow(groups, 'paste').isDisabled).toBe(true)
        expect(findRow(groups, 'delete').isDisabled).toBe(true)
        expect(findRow(groups, 'insert-link').isDisabled).toBe(true)
        expect(findRow(groups, 'table-delete-row').isDisabled).toBe(true)

        // Copy is a read-only operation; Select all is selection-only.
        expect(findRow(groups, 'copy').isDisabled).toBe(false)
        expect(findRow(groups, 'select-all').isDisabled).toBe(false)
    })

    it('relabels Insert link to Edit link when the caret is on an existing link', () => {
        const groups = buildDocumentContextMenu({
            commands: makeCommands(),
            toolbarState: makeToolbarState({ isLinkActive: true }),
            editable: true,
            onRequestInsertLink: () => undefined,
        })

        expect(findRow(groups, 'insert-link').label).toBe('Edit link')
    })

    it('routes each row to the matching command', () => {
        const commands = makeCommands()
        const onRequestInsertLink = vi.fn()
        const groups = buildDocumentContextMenu({
            commands,
            toolbarState: makeToolbarState({ selectionEmpty: false, isInTable: true }),
            editable: true,
            onRequestInsertLink,
        })

        findRow(groups, 'cut').invoke()
        findRow(groups, 'paste').invoke()
        findRow(groups, 'insert-link').invoke()
        findRow(groups, 'table-delete-row').invoke()

        expect(commands.cut).toHaveBeenCalledTimes(1)
        expect(commands.paste).toHaveBeenCalledTimes(1)
        expect(commands.deleteRow).toHaveBeenCalledTimes(1)
        expect(onRequestInsertLink).toHaveBeenCalledTimes(1)
    })
})
