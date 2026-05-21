import type { Scope, Shortcut } from '@tinycld/core/lib/shortcuts/types'
import { useRegisterShortcuts } from '@tinycld/core/lib/shortcuts/use-register'
import { useMemo } from 'react'
import type { FindActions } from './find/use-find-actions'
import type { FindStoreApi } from './find/use-find-store'
import type { GridStoreApi } from './grid-store'
import type { ClipboardActions } from './use-clipboard'

export interface CalcFormatShortcutCallbacks {
    toggleBold: () => void
    toggleItalic: () => void
    toggleUnderline: () => void
    toggleStrike: () => void
    clearFormatting: () => void
}

export interface UseCalcShortcutsArgs {
    store: GridStoreApi
    clipboard: ClipboardActions
    format: CalcFormatShortcutCallbacks
    find: FindActions
    findStore: FindStoreApi
    readOnly?: boolean
}

// Discriminated union over the predicate every shortcut needs. The
// keyboard registry calls `when` before firing; the docs renderer
// ignores it. Encoding the gates here — rather than as opaque closures
// embedded in the shortcut entry — lets buildCalcShortcuts attach the
// right `when` at runtime from a single source-of-truth shortcut list.
type GateKind =
    | 'selectedCell' // cell is selected, not editing, find dialog closed
    | 'selectedCellWritable' // selectedCell + !readOnly
    | 'cutPending' // a copy/cut marker is showing
    | 'editingClosed' // not currently editing a cell
    | 'editingClosedWritable' // not editing + !readOnly
    | 'findOpen' // the find overlay is visible

// Discriminated union over the side effects. buildCalcShortcuts looks
// up the matching closure based on `action` and binds it to the
// caller's handler bundle. Keeping the mapping centralized means
// adding a new shortcut is one entry in SHORTCUT_DOCS plus one branch
// here; nothing else gets edited.
type ActionKind =
    | 'clipboardCopy'
    | 'clipboardCut'
    | 'clipboardCancelCut'
    | 'clipboardPasteAll'
    | 'clipboardPasteValues'
    | 'clipboardPasteFormulas'
    | 'clipboardPasteFormat'
    | 'clipboardPasteTranspose'
    | 'formatBold'
    | 'formatItalic'
    | 'formatUnderline'
    | 'formatStrike'
    | 'formatClearFormatting'
    | 'findOpen'
    | 'findOpenReplace'
    | 'findNext'
    | 'findPrev'

interface ShortcutEntry {
    id: string
    keys: string
    description: string
    group: string
    scope: Scope
    allowInInputs?: boolean
    gate: GateKind
    action: ActionKind
}

// Single source of truth for every Calc shortcut. buildCalcShortcuts
// maps over this list to attach live `when` + `run` closures; the
// `CalcShortcutDoc` view (consumed by the Help → Keyboard shortcuts
// dialog) strips `gate` + `action` and returns just the metadata.
// Adding a shortcut is one entry here plus a case in `gateFor` and
// `actionFor` below.
const SHORTCUT_DOCS: readonly ShortcutEntry[] = [
    {
        id: 'calc.clipboard.copy',
        keys: '$mod+c',
        description: 'Copy',
        group: 'Calc',
        scope: 'global',
        gate: 'selectedCell',
        action: 'clipboardCopy',
    },
    {
        id: 'calc.clipboard.cut',
        keys: '$mod+x',
        description: 'Cut',
        group: 'Calc',
        scope: 'global',
        gate: 'selectedCellWritable',
        action: 'clipboardCut',
    },
    {
        id: 'calc.clipboard.cancelCut',
        keys: 'Escape',
        description: 'Cancel cut',
        group: 'Calc',
        scope: 'global',
        gate: 'cutPending',
        action: 'clipboardCancelCut',
    },
    {
        id: 'calc.clipboard.paste',
        keys: '$mod+v',
        description: 'Paste',
        group: 'Calc',
        scope: 'global',
        gate: 'selectedCellWritable',
        action: 'clipboardPasteAll',
    },
    {
        id: 'calc.clipboard.pasteValues',
        keys: '$mod+Shift+v',
        description: 'Paste values only',
        group: 'Calc',
        scope: 'global',
        gate: 'selectedCellWritable',
        action: 'clipboardPasteValues',
    },
    {
        id: 'calc.clipboard.pasteFormulas',
        keys: '$mod+Alt+v',
        description: 'Paste formulas only',
        group: 'Calc',
        scope: 'global',
        gate: 'selectedCellWritable',
        action: 'clipboardPasteFormulas',
    },
    {
        id: 'calc.clipboard.pasteFormat',
        keys: '$mod+Alt+Shift+v',
        description: 'Paste format only',
        group: 'Calc',
        scope: 'global',
        gate: 'selectedCellWritable',
        action: 'clipboardPasteFormat',
    },
    {
        id: 'calc.clipboard.pasteTranspose',
        keys: '$mod+Alt+t',
        description: 'Paste transposed',
        group: 'Calc',
        scope: 'global',
        gate: 'selectedCellWritable',
        action: 'clipboardPasteTranspose',
    },
    {
        id: 'calc.format.bold',
        keys: '$mod+b',
        description: 'Bold',
        group: 'Calc',
        scope: 'global',
        gate: 'selectedCellWritable',
        action: 'formatBold',
    },
    {
        id: 'calc.format.italic',
        keys: '$mod+i',
        description: 'Italic',
        group: 'Calc',
        scope: 'global',
        gate: 'selectedCellWritable',
        action: 'formatItalic',
    },
    {
        id: 'calc.format.underline',
        keys: '$mod+u',
        description: 'Underline',
        group: 'Calc',
        scope: 'global',
        gate: 'selectedCellWritable',
        action: 'formatUnderline',
    },
    {
        // Cmd+Shift+X mirrors the Google Sheets convention. Cmd+5
        // (Sheets' default) is intercepted by some browsers as a
        // tab-switch shortcut, so we stay clear of it.
        id: 'calc.format.strike',
        keys: '$mod+Shift+x',
        description: 'Strikethrough',
        group: 'Calc',
        scope: 'global',
        gate: 'selectedCellWritable',
        action: 'formatStrike',
    },
    {
        id: 'calc.format.clearFormatting',
        keys: '$mod+\\',
        description: 'Clear formatting',
        group: 'Calc',
        scope: 'global',
        gate: 'selectedCellWritable',
        action: 'formatClearFormatting',
    },
    {
        id: 'calc.find.open',
        keys: '$mod+f',
        description: 'Find',
        group: 'Calc',
        scope: 'global',
        allowInInputs: true,
        gate: 'editingClosed',
        action: 'findOpen',
    },
    {
        // Replace is a write op — `editingClosedWritable` gates it off
        // for read-only viewers. Find (above) uses `editingClosed` since
        // browsing matches is harmless without write permission.
        id: 'calc.find.openReplace',
        keys: '$mod+Shift+h',
        description: 'Find and replace',
        group: 'Calc',
        scope: 'global',
        allowInInputs: true,
        gate: 'editingClosedWritable',
        action: 'findOpenReplace',
    },
    {
        id: 'calc.find.next',
        keys: '$mod+g',
        description: 'Next match',
        group: 'Calc',
        scope: 'global',
        allowInInputs: true,
        gate: 'findOpen',
        action: 'findNext',
    },
    {
        id: 'calc.find.prev',
        keys: '$mod+Shift+g',
        description: 'Previous match',
        group: 'Calc',
        scope: 'global',
        allowInInputs: true,
        gate: 'findOpen',
        action: 'findPrev',
    },
]

// CalcShortcutDoc is the public shape the Keyboard shortcuts help
// dialog consumes. Strips the internal `gate` + `action` discriminators
// so external code can't depend on them.
export interface CalcShortcutDoc {
    id: string
    keys: string
    description: string
    group: string
}

// Frozen so repeated callers (and tests) get a stable identity rather
// than a fresh array every call. `SHORTCUT_DOCS` is `readonly` already;
// this projection peels off the internal `gate`/`action` discriminators
// once and reuses the result.
const CALC_SHORTCUT_DOCS: readonly CalcShortcutDoc[] = Object.freeze(
    SHORTCUT_DOCS.map(({ id, keys, description, group }) =>
        Object.freeze({ id, keys, description, group })
    )
)

export function getCalcShortcutDocs(): readonly CalcShortcutDoc[] {
    return CALC_SHORTCUT_DOCS
}

// buildCalcShortcuts is the pure shortcut-list factory used by both
// the React hook (memoised) and unit tests. Keeping it standalone
// means tests can assert the registered keybindings, gate predicates,
// and run callbacks without spinning up a React renderer.
export function buildCalcShortcuts(args: UseCalcShortcutsArgs): Shortcut[] {
    return SHORTCUT_DOCS.map(entry => ({
        id: entry.id,
        keys: entry.keys,
        scope: entry.scope,
        group: entry.group,
        description: entry.description,
        allowInInputs: entry.allowInInputs,
        when: gateFor(entry.gate, args),
        run: actionFor(entry.action, args),
    }))
}

function unreachable(value: never): never {
    throw new Error(`unreachable: ${String(value)}`)
}

// gateFor returns the predicate the keyboard registry consults before
// firing a shortcut. Centralised here (rather than embedded in each
// SHORTCUT_DOCS entry as a closure) so the docs view can ignore them.
// The find dialog suspends regular grid shortcuts; find's own
// next/prev/close use the `findOpen` gate so they keep firing while
// the overlay is up. `findOpenReplace` uses `editingClosedWritable`
// (rather than the read-only `editingClosed` gate that opens read-only
// Find) because Replace is a write op — keep this distinction; relaxing
// it would let read-only viewers issue replaces.
function gateFor(kind: GateKind, args: UseCalcShortcutsArgs): () => boolean {
    const { store, findStore, readOnly = false } = args
    const baseWhen = () => {
        const s = store.getState()
        if (findStore.getState().isOpen) return false
        return s.selection != null && s.editSession == null
    }
    switch (kind) {
        case 'selectedCell':
            return baseWhen
        case 'selectedCellWritable':
            return () => baseWhen() && !readOnly
        case 'cutPending':
            return () => store.getState().cutPending
        case 'editingClosed':
            return () => store.getState().editSession == null
        case 'editingClosedWritable':
            return () => !readOnly && store.getState().editSession == null
        case 'findOpen':
            return () => findStore.getState().isOpen
        default:
            return unreachable(kind)
    }
}

function actionFor(kind: ActionKind, args: UseCalcShortcutsArgs): () => void {
    const { store, clipboard, format, find } = args
    switch (kind) {
        case 'clipboardCopy':
            return () => {
                void clipboard.copy()
            }
        case 'clipboardCut':
            return () => {
                void clipboard.cut()
            }
        case 'clipboardCancelCut':
            return () => {
                store.getState().clearClipboardMarker()
            }
        case 'clipboardPasteAll':
            return () => {
                void clipboard.paste('all')
            }
        case 'clipboardPasteValues':
            return () => {
                void clipboard.paste('values')
            }
        case 'clipboardPasteFormulas':
            return () => {
                void clipboard.paste('formulas')
            }
        case 'clipboardPasteFormat':
            return () => {
                void clipboard.paste('format')
            }
        case 'clipboardPasteTranspose':
            return () => {
                void clipboard.paste('transpose')
            }
        case 'formatBold':
            return () => format.toggleBold()
        case 'formatItalic':
            return () => format.toggleItalic()
        case 'formatUnderline':
            return () => format.toggleUnderline()
        case 'formatStrike':
            return () => format.toggleStrike()
        case 'formatClearFormatting':
            return () => format.clearFormatting()
        case 'findOpen':
            return () => find.openFind()
        case 'findOpenReplace':
            return () => find.openReplace()
        case 'findNext':
            return () => find.nextMatch()
        case 'findPrev':
            return () => find.prevMatch()
        default:
            return unreachable(kind)
    }
}

export function useCalcShortcuts({
    store,
    clipboard,
    format,
    find,
    findStore,
    readOnly = false,
}: UseCalcShortcutsArgs) {
    const shortcuts = useMemo<Shortcut[]>(
        () => buildCalcShortcuts({ store, clipboard, format, find, findStore, readOnly }),
        [store, clipboard, format, find, findStore, readOnly]
    )

    useRegisterShortcuts(shortcuts)
}
