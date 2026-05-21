import { describe, expect, it, vi } from 'vitest'
import { handleNewComposeIntent } from '../tinycld/mail/hooks/composeEvents'
import type { ComposeMode } from '../tinycld/mail/hooks/useComposeState'

function makeState(mode: ComposeMode) {
    return {
        mode,
        open: vi.fn(),
        close: vi.fn(),
    }
}

describe('handleNewComposeIntent', () => {
    it('opens a fresh window when mode is closed', () => {
        const state = makeState('closed')
        handleNewComposeIntent(state)
        expect(state.open).toHaveBeenCalledOnce()
        expect(state.close).not.toHaveBeenCalled()
    })

    it('clears inline reply and opens a fresh window when mode is inline', () => {
        const state = makeState('inline')
        handleNewComposeIntent(state)
        expect(state.close).toHaveBeenCalledOnce()
        expect(state.open).toHaveBeenCalledOnce()
    })

    it('leaves an open compose window alone', () => {
        const state = makeState('open')
        handleNewComposeIntent(state)
        expect(state.open).not.toHaveBeenCalled()
        expect(state.close).not.toHaveBeenCalled()
    })

    it('leaves a minimized compose window alone', () => {
        const state = makeState('minimized')
        handleNewComposeIntent(state)
        expect(state.open).not.toHaveBeenCalled()
        expect(state.close).not.toHaveBeenCalled()
    })

    it('leaves a maximized compose window alone', () => {
        const state = makeState('maximized')
        handleNewComposeIntent(state)
        expect(state.open).not.toHaveBeenCalled()
        expect(state.close).not.toHaveBeenCalled()
    })
})
