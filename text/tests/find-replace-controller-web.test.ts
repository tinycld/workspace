// Unit tests for the web FindReplaceController. Wraps an in-process
// FindReplaceEditor (state + dispatch) and exposes the controller
// surface the FindReplaceBar consumes.

import { describe, expect, it, vi } from 'vitest'
import { makeWebFindReplaceController } from '../tinycld/text/lib/find-replace-controller-web'
import {
    type FindReplaceEditor,
    findReplacePluginKey,
} from '../tinycld/text/lib/find-replace-plugin'

// Build a fake FindReplaceEditor that records dispatched transactions
// and exposes a settable plugin state. The plugin-state read is
// re-routed onto a property of `state._pluginState` via a vi.spyOn on
// findReplacePluginKey.getState — see patchPluginKey().
function makeFakeEditor(initial: {
    matches?: Array<{ from: number; to: number }>
    currentIndex?: number
    query?: string
}) {
    const dispatched: Array<{ meta: unknown }> = []
    const pluginState = {
        query: initial.query ?? '',
        matches: initial.matches ?? [],
        currentIndex: initial.currentIndex ?? 0,
    }
    const editor: FindReplaceEditor = {
        state: {
            _pluginState: pluginState,
            tr: {
                setMeta: (_key: unknown, meta: unknown) => ({ meta }),
                insertText: vi.fn(),
            },
            doc: { descendants: () => undefined },
        } as unknown as FindReplaceEditor['state'],
        dispatch: tr => {
            dispatched.push({ meta: (tr as { meta?: unknown }).meta })
        },
    }
    return { editor, dispatched, pluginState }
}

function patchPluginKey() {
    return vi
        .spyOn(findReplacePluginKey, 'getState')
        .mockImplementation((state: unknown) => {
            return (state as { _pluginState?: unknown })._pluginState as never
        })
}

// --- getState --------------------------------------------------------

describe('makeWebFindReplaceController — getState', () => {
    it('reads matchCount/currentIndex/query from the plugin state', () => {
        const restore = patchPluginKey()
        try {
            const fake = makeFakeEditor({
                matches: [
                    { from: 0, to: 3 },
                    { from: 5, to: 8 },
                ],
                currentIndex: 1,
                query: 'foo',
            })
            const c = makeWebFindReplaceController(fake.editor)
            expect(c.getState()).toEqual({ matchCount: 2, currentIndex: 1, query: 'foo' })
        } finally {
            restore.mockRestore()
        }
    })

    it('returns an empty state object when the plugin state is missing', () => {
        const restore = vi
            .spyOn(findReplacePluginKey, 'getState')
            .mockImplementation(() => null as never)
        try {
            const fake = makeFakeEditor({})
            const c = makeWebFindReplaceController(fake.editor)
            expect(c.getState()).toEqual({ matchCount: 0, currentIndex: 0, query: '' })
        } finally {
            restore.mockRestore()
        }
    })
})

// --- commands dispatch onto the editor's view -------------------------

describe('makeWebFindReplaceController — commands', () => {
    it('setQuery dispatches a setMeta transaction with setQuery meta', () => {
        const restore = patchPluginKey()
        try {
            const fake = makeFakeEditor({})
            const c = makeWebFindReplaceController(fake.editor)
            c.setQuery('foo')
            expect(fake.dispatched).toHaveLength(1)
            expect(fake.dispatched[0].meta).toEqual({ setQuery: 'foo' })
        } finally {
            restore.mockRestore()
        }
    })

    it('clear dispatches a clear-meta transaction', () => {
        const restore = patchPluginKey()
        try {
            const fake = makeFakeEditor({})
            const c = makeWebFindReplaceController(fake.editor)
            c.clear()
            expect(fake.dispatched).toHaveLength(1)
            expect(fake.dispatched[0].meta).toEqual({ clear: true })
        } finally {
            restore.mockRestore()
        }
    })

    it('next/prev no-op when there are no matches', () => {
        const restore = patchPluginKey()
        try {
            const fake = makeFakeEditor({ matches: [], currentIndex: 0 })
            const c = makeWebFindReplaceController(fake.editor)
            c.next()
            c.prev()
            expect(fake.dispatched).toHaveLength(0)
        } finally {
            restore.mockRestore()
        }
    })

    it('replaceCurrent / replaceAll no-op when there are no matches', () => {
        const restore = patchPluginKey()
        try {
            const fake = makeFakeEditor({ matches: [], currentIndex: 0 })
            const c = makeWebFindReplaceController(fake.editor)
            c.replaceCurrent('x')
            c.replaceAll('y')
            expect(fake.dispatched).toHaveLength(0)
        } finally {
            restore.mockRestore()
        }
    })
})
