import { describe, expect, it, vi } from 'vitest'
import type { FindActions } from '../tinycld/calc/hooks/find/use-find-actions'
import type { FindStoreApi } from '../tinycld/calc/hooks/find/use-find-store'
import type { GridStoreApi } from '../tinycld/calc/hooks/grid-store'
import {
    buildCalcShortcuts,
    type CalcFormatShortcutCallbacks,
} from '../tinycld/calc/hooks/use-calc-shortcuts'
import type { ClipboardActions } from '../tinycld/calc/hooks/use-clipboard'

// buildCalcShortcuts is the pure factory the React hook wraps. Tests
// exercise it directly so we can pin the keybindings and gate
// predicates without rendering React.

interface FakeStoreState {
    selection: { ranges: Array<unknown> } | null
    editSession: { draft: string } | null
    cutPending: boolean
    clearClipboardMarker: () => void
}

function makeStore(overrides: Partial<FakeStoreState> = {}): GridStoreApi {
    const state: FakeStoreState = {
        selection: {
            ranges: [
                {
                    anchor: { row: 1, col: 1 },
                    range: { startRow: 1, endRow: 1, startCol: 1, endCol: 1 },
                    scope: 'cells',
                },
            ],
        },
        editSession: null,
        cutPending: false,
        clearClipboardMarker: vi.fn(),
        ...overrides,
    }
    return {
        getState: () => state as unknown as ReturnType<GridStoreApi['getState']>,
    } as unknown as GridStoreApi
}

function makeClipboard(): ClipboardActions {
    return {
        copy: vi.fn(),
        cut: vi.fn(),
        paste: vi.fn(),
    } as unknown as ClipboardActions
}

function makeFormatCallbacks(): CalcFormatShortcutCallbacks {
    return {
        toggleBold: vi.fn(),
        toggleItalic: vi.fn(),
        toggleUnderline: vi.fn(),
        toggleStrike: vi.fn(),
        clearFormatting: vi.fn(),
    }
}

// Find dialog stubs — the merged shortcut bundle requires a find/findStore
// pair to wire Cmd+F / Cmd+Shift+H / Cmd+G. Format-shortcut tests don't
// exercise those bindings; the stubs are present only to satisfy the
// argument shape.
function makeFind(): FindActions {
    return {
        openFind: vi.fn(),
        openReplace: vi.fn(),
        close: vi.fn(),
        nextMatch: vi.fn(),
        prevMatch: vi.fn(),
        replaceCurrent: vi.fn(),
        replaceAll: vi.fn(),
    }
}

function makeFindStore(isOpen = false): FindStoreApi {
    return {
        getState: () => ({ isOpen }) as unknown as ReturnType<FindStoreApi['getState']>,
    } as unknown as FindStoreApi
}

const FORMAT_IDS = [
    'calc.format.bold',
    'calc.format.italic',
    'calc.format.underline',
    'calc.format.strike',
] as const

describe('buildCalcShortcuts — format shortcuts', () => {
    it('registers Cmd+B / Cmd+I / Cmd+U / Cmd+Shift+X under the Calc group', () => {
        const list = buildCalcShortcuts({
            store: makeStore(),
            clipboard: makeClipboard(),
            format: makeFormatCallbacks(),
            find: makeFind(),
            findStore: makeFindStore(),
        })

        const byId = new Map(list.map(s => [s.id, s]))
        expect(byId.get('calc.format.bold')?.keys).toBe('$mod+b')
        expect(byId.get('calc.format.italic')?.keys).toBe('$mod+i')
        expect(byId.get('calc.format.underline')?.keys).toBe('$mod+u')
        expect(byId.get('calc.format.strike')?.keys).toBe('$mod+Shift+x')

        for (const id of FORMAT_IDS) {
            const s = byId.get(id)
            expect(s, `${id} should be registered`).toBeDefined()
            expect(s?.group).toBe('Calc')
            expect(s?.scope).toBe('global')
        }
    })

    it('Cmd+B run() invokes toggleBold', () => {
        const format = makeFormatCallbacks()
        const list = buildCalcShortcuts({
            store: makeStore(),
            clipboard: makeClipboard(),
            format,
            find: makeFind(),
            findStore: makeFindStore(),
        })
        const bold = list.find(s => s.id === 'calc.format.bold')
        expect(bold).toBeDefined()
        bold?.run({ keys: '$mod+b' })

        expect(format.toggleBold).toHaveBeenCalledTimes(1)
        expect(format.toggleItalic).not.toHaveBeenCalled()
        expect(format.toggleUnderline).not.toHaveBeenCalled()
        expect(format.toggleStrike).not.toHaveBeenCalled()
    })

    it('Cmd+I run() invokes toggleItalic', () => {
        const format = makeFormatCallbacks()
        const list = buildCalcShortcuts({
            store: makeStore(),
            clipboard: makeClipboard(),
            format,
            find: makeFind(),
            findStore: makeFindStore(),
        })
        list.find(s => s.id === 'calc.format.italic')?.run({ keys: '$mod+i' })
        expect(format.toggleItalic).toHaveBeenCalledTimes(1)
    })

    it('Cmd+U run() invokes toggleUnderline', () => {
        const format = makeFormatCallbacks()
        const list = buildCalcShortcuts({
            store: makeStore(),
            clipboard: makeClipboard(),
            format,
            find: makeFind(),
            findStore: makeFindStore(),
        })
        list.find(s => s.id === 'calc.format.underline')?.run({ keys: '$mod+u' })
        expect(format.toggleUnderline).toHaveBeenCalledTimes(1)
    })

    it('Cmd+Shift+X run() invokes toggleStrike', () => {
        const format = makeFormatCallbacks()
        const list = buildCalcShortcuts({
            store: makeStore(),
            clipboard: makeClipboard(),
            format,
            find: makeFind(),
            findStore: makeFindStore(),
        })
        list.find(s => s.id === 'calc.format.strike')?.run({ keys: '$mod+Shift+x' })
        expect(format.toggleStrike).toHaveBeenCalledTimes(1)
    })

    it('format shortcuts are gated off when no cell is selected', () => {
        const list = buildCalcShortcuts({
            store: makeStore({ selection: null }),
            clipboard: makeClipboard(),
            format: makeFormatCallbacks(),
            find: makeFind(),
            findStore: makeFindStore(),
        })
        for (const id of FORMAT_IDS) {
            const when = list.find(s => s.id === id)?.when
            expect(when?.(), `${id} should be gated off without a selection`).toBe(false)
        }
    })

    it('format shortcuts are gated off while an edit session is open', () => {
        const list = buildCalcShortcuts({
            store: makeStore({ editSession: { draft: 'hello' } }),
            clipboard: makeClipboard(),
            format: makeFormatCallbacks(),
            find: makeFind(),
            findStore: makeFindStore(),
        })
        for (const id of FORMAT_IDS) {
            const when = list.find(s => s.id === id)?.when
            expect(when?.(), `${id} should be gated off while editing`).toBe(false)
        }
    })

    it('format shortcuts are gated off in readOnly mode', () => {
        const list = buildCalcShortcuts({
            store: makeStore(),
            clipboard: makeClipboard(),
            format: makeFormatCallbacks(),
            find: makeFind(),
            findStore: makeFindStore(),
            readOnly: true,
        })
        for (const id of FORMAT_IDS) {
            const when = list.find(s => s.id === id)?.when
            expect(when?.(), `${id} should be gated off in readOnly mode`).toBe(false)
        }
    })

    it('format shortcuts pass the gate when a cell is selected and not editing', () => {
        const list = buildCalcShortcuts({
            store: makeStore(),
            clipboard: makeClipboard(),
            format: makeFormatCallbacks(),
            find: makeFind(),
            findStore: makeFindStore(),
        })
        for (const id of FORMAT_IDS) {
            const when = list.find(s => s.id === id)?.when
            expect(when?.(), `${id} should pass the default gate`).toBe(true)
        }
    })
})
