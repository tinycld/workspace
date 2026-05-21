// Pure classifier for the cell's onKeyDown handler. Keeps the
// branching out of Cell.tsx so it can be unit-tested without a render
// and so the rules stay in one place when more keys grow into the
// "selected, not editing" handler.
//
// Inputs: just the bits of a keydown event we actually look at —
// `key` and the three modifier flags. Output is a discriminated
// action the caller dispatches to the grid store.

export interface CellKeyEvent {
    key?: string
    ctrlKey?: boolean
    metaKey?: boolean
    altKey?: boolean
    shiftKey?: boolean
}

export type ArrowDirection = 'up' | 'down' | 'left' | 'right'

export type CellKeyAction =
    | { kind: 'ignore' }
    | { kind: 'clear' }
    | { kind: 'startEdit'; seed: string }
    | { kind: 'arrow'; direction: ArrowDirection }
    | { kind: 'extend'; direction: ArrowDirection }

// classifyCellKey returns the action to take for a keypress on a
// focused, non-editing cell. Modifier-combo keys (Cmd+B, Ctrl+C, …)
// always ignore here — they belong to the global shortcut registry.
//
// Arrow keys produce an 'arrow' action so Cell.tsx can collapse a
// disjoint selection to a single cell before letting the browser's
// focus traversal walk to the neighbor cell (plan §6.c). On a
// single-rectangle selection the collapse is a no-op and arrow nav
// continues unchanged via the Pressable focus order.
//
// Shift+arrow produces an 'extend' action so the caller can grow (or
// shrink) the active sub-range by one cell in that direction —
// Sheets / Excel parity for keyboard-driven range selection.
//
// Printable single-character keys trigger startEdit with the typed
// character as the seed, matching Sheets / Excel's "start typing to
// replace" behavior.
export function classifyCellKey(e: CellKeyEvent): CellKeyAction {
    const key = e.key
    if (key == null) return { kind: 'ignore' }
    if (key === 'Delete' || key === 'Backspace') return { kind: 'clear' }
    const dir = arrowDirection(key)
    if (dir != null) {
        if (e.ctrlKey || e.metaKey || e.altKey) return { kind: 'ignore' }
        return e.shiftKey ? { kind: 'extend', direction: dir } : { kind: 'arrow', direction: dir }
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return { kind: 'ignore' }
    // Single-character printable keys only.
    if (key.length !== 1 || key < ' ') return { kind: 'ignore' }
    return { kind: 'startEdit', seed: key }
}

function arrowDirection(key: string): ArrowDirection | null {
    switch (key) {
        case 'ArrowUp':
            return 'up'
        case 'ArrowDown':
            return 'down'
        case 'ArrowLeft':
            return 'left'
        case 'ArrowRight':
            return 'right'
        default:
            return null
    }
}
