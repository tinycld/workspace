import type { EditorCommands, EditorToolbarState } from '@tinycld/core/lib/editor/types'

// Identifier for each row the context menu can show. Used both by the
// renderer (to map descriptors to icons/shortcuts) and by tests, so the
// visible-set + enabled-set is locked down without rendering React.
export type ContextMenuItemId =
    | 'cut'
    | 'copy'
    | 'paste'
    | 'delete'
    | 'select-all'
    | 'insert-link'
    | 'add-comment'
    | 'table-insert-row-above'
    | 'table-insert-row-below'
    | 'table-insert-column-left'
    | 'table-insert-column-right'
    | 'table-merge-cells'
    | 'table-split-cell'
    | 'table-delete-row'
    | 'table-delete-column'
    | 'table-delete-table'

export interface ContextMenuRow {
    id: ContextMenuItemId
    label: string
    isDisabled: boolean
    invoke: () => void
}

export interface ContextMenuGroup {
    label?: string
    rows: ContextMenuRow[]
}

interface BuildArgs {
    commands: EditorCommands
    toolbarState: EditorToolbarState
    editable: boolean
    onRequestInsertLink: () => void
    // Optional: surfaces the "Add comment" row. Omit when the comment
    // system isn't mounted (e.g. native v1). When provided, the row is
    // rendered but only enabled when canAddComment is true (the screen
    // computes this from editable + non-empty selection + bridge).
    onRequestAddComment?: () => void
    canAddComment?: boolean
}

// buildDocumentContextMenu returns the groups that should be rendered
// in the context menu, given the editor's current toolbar state and
// editable flag. Pure function so a unit test can lock the
// context-sensitive logic without rendering React.
export function buildDocumentContextMenu({
    commands,
    toolbarState,
    editable,
    onRequestInsertLink,
    onRequestAddComment,
    canAddComment = false,
}: BuildArgs): ContextMenuGroup[] {
    const hasSelection = !(toolbarState.selectionEmpty ?? true)
    const isInTable = toolbarState.isInTable ?? false

    const clipboard: ContextMenuRow[] = [
        {
            id: 'cut',
            label: 'Cut',
            isDisabled: !editable || !hasSelection,
            invoke: () => commands.cut?.(),
        },
        {
            id: 'copy',
            label: 'Copy',
            isDisabled: !hasSelection,
            invoke: () => commands.copy?.(),
        },
        {
            id: 'paste',
            label: 'Paste',
            isDisabled: !editable,
            invoke: () => commands.paste?.(),
        },
        {
            id: 'delete',
            label: 'Delete',
            isDisabled: !editable || !hasSelection,
            invoke: () => commands.deleteSelection?.(),
        },
        {
            id: 'select-all',
            label: 'Select all',
            isDisabled: false,
            invoke: () => commands.selectAll?.(),
        },
    ]

    const link: ContextMenuRow[] = [
        {
            id: 'insert-link',
            label: toolbarState.isLinkActive ? 'Edit link' : 'Insert link',
            isDisabled: !editable,
            invoke: onRequestInsertLink,
        },
    ]

    const groups: ContextMenuGroup[] = [{ rows: clipboard }, { rows: link }]

    if (onRequestAddComment) {
        groups.push({
            rows: [
                {
                    id: 'add-comment',
                    label: 'Add comment',
                    isDisabled: !canAddComment,
                    invoke: onRequestAddComment,
                },
            ],
        })
    }

    if (isInTable) {
        groups.push({
            label: 'Table',
            rows: [
                {
                    id: 'table-insert-row-above',
                    label: 'Insert row above',
                    isDisabled: !editable,
                    invoke: () => commands.addRowBefore?.(),
                },
                {
                    id: 'table-insert-row-below',
                    label: 'Insert row below',
                    isDisabled: !editable,
                    invoke: () => commands.addRowAfter?.(),
                },
                {
                    id: 'table-insert-column-left',
                    label: 'Insert column left',
                    isDisabled: !editable,
                    invoke: () => commands.addColumnBefore?.(),
                },
                {
                    id: 'table-insert-column-right',
                    label: 'Insert column right',
                    isDisabled: !editable,
                    invoke: () => commands.addColumnAfter?.(),
                },
                {
                    id: 'table-merge-cells',
                    label: 'Merge cells',
                    isDisabled: !editable || !(toolbarState.canMergeCells ?? false),
                    invoke: () => commands.mergeCells?.(),
                },
                {
                    id: 'table-split-cell',
                    label: 'Split cell',
                    isDisabled: !editable || !(toolbarState.canSplitCell ?? false),
                    invoke: () => commands.splitCell?.(),
                },
                {
                    id: 'table-delete-row',
                    label: 'Delete row',
                    isDisabled: !editable,
                    invoke: () => commands.deleteRow?.(),
                },
                {
                    id: 'table-delete-column',
                    label: 'Delete column',
                    isDisabled: !editable,
                    invoke: () => commands.deleteColumn?.(),
                },
                {
                    id: 'table-delete-table',
                    label: 'Delete table',
                    isDisabled: !editable,
                    invoke: () => commands.deleteTable?.(),
                },
            ],
        })
    }

    return groups
}
