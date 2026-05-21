// SaveStatusIndicator's visible label is a pure function of
// (saveStatus, isConnected). The component itself is RN + Uniwind
// and can't render under Vitest's node environment, so we lock the
// state-machine contract via the extracted pure helper. End-to-end
// rendering coverage lands in the Playwright suite.
//
// The connection gate is the load-bearing piece: without it, the
// indicator says "Saved" during reconnect windows while local
// edits queue up offline — see docs/TODO.md item 5.

import { describe, expect, it } from 'vitest'
import {
    saveStatusLabel,
    saveStatusState,
} from '../tinycld/text/components/save-status-state'

describe('saveStatusState', () => {
    it('reports offline when disconnected, regardless of saveStatus', () => {
        expect(saveStatusState({ status: 'ok', isConnected: false })).toBe('offline')
        expect(saveStatusState({ status: 'failed', isConnected: false })).toBe('offline')
    })

    it('reports saved on a healthy connection with ok status', () => {
        expect(saveStatusState({ status: 'ok', isConnected: true })).toBe('saved')
    })

    it('reports failed on a healthy connection with failed status', () => {
        expect(saveStatusState({ status: 'failed', isConnected: true })).toBe('failed')
    })
})

describe('saveStatusLabel', () => {
    it('uses a stable, user-visible string per state', () => {
        // Locked because Playwright specs and analytics may match
        // on the visible label. Changing one of these is a
        // deliberate UX call, not a casual rename.
        expect(saveStatusLabel.saved).toBe('Saved')
        expect(saveStatusLabel.failed).toBe('Save failed')
        expect(saveStatusLabel.offline).toBe('Offline')
    })
})
