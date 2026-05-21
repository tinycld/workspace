// FindReplaceStore tracks the bar's open state plus the persisted
// find/replace strings across open/close cycles within a session. The
// tests exercise the public actions; the store has no derived state
// so the assertions are straight reads.

import { beforeEach, describe, expect, it } from 'vitest'
import { useFindReplaceStore } from '../tinycld/text/lib/stores/find-replace-store'

// vitest tests share a module graph, so the singleton store needs a
// reset between cases — otherwise the previous test's `findQuery`
// bleeds into the next.
function resetStore() {
    useFindReplaceStore.setState({
        isOpen: false,
        findQuery: '',
        replaceQuery: '',
    })
}

describe('useFindReplaceStore', () => {
    beforeEach(() => resetStore())

    it('starts closed with empty find/replace strings', () => {
        const s = useFindReplaceStore.getState()
        expect(s.isOpen).toBe(false)
        expect(s.findQuery).toBe('')
        expect(s.replaceQuery).toBe('')
    })

    it('open() flips isOpen without touching the queries', () => {
        useFindReplaceStore.setState({ findQuery: 'foo', replaceQuery: 'bar' })
        useFindReplaceStore.getState().open()
        const s = useFindReplaceStore.getState()
        expect(s.isOpen).toBe(true)
        expect(s.findQuery).toBe('foo')
        expect(s.replaceQuery).toBe('bar')
    })

    it('close() flips isOpen back without touching the queries', () => {
        useFindReplaceStore.setState({ isOpen: true, findQuery: 'foo', replaceQuery: 'bar' })
        useFindReplaceStore.getState().close()
        const s = useFindReplaceStore.getState()
        expect(s.isOpen).toBe(false)
        expect(s.findQuery).toBe('foo')
        expect(s.replaceQuery).toBe('bar')
    })

    it('setFindQuery / setReplaceQuery update the matching field', () => {
        useFindReplaceStore.getState().setFindQuery('hello')
        useFindReplaceStore.getState().setReplaceQuery('world')
        const s = useFindReplaceStore.getState()
        expect(s.findQuery).toBe('hello')
        expect(s.replaceQuery).toBe('world')
    })

    it('queries survive close→open cycles (match Cmd+F UX)', () => {
        useFindReplaceStore.getState().setFindQuery('persist')
        useFindReplaceStore.getState().open()
        useFindReplaceStore.getState().close()
        useFindReplaceStore.getState().open()
        expect(useFindReplaceStore.getState().findQuery).toBe('persist')
    })
})
