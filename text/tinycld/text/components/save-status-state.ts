// SaveStatusIndicator's externally observable state is one of three
// labels (Saved / Save failed / Offline). The state transitions are
// pure: a function of (saveStatus, isConnected). Extracting that
// decision as a helper lets us unit-test the contract under Vitest's
// node environment (the RN component itself needs a real renderer).

export type SaveStatusState = 'saved' | 'failed' | 'offline'

export interface SaveStatusInputs {
    status: 'ok' | 'failed'
    isConnected: boolean
}

// Disconnected wins over saveStatus: while the WebSocket is down the
// broker can't ack writes, so the last 'ok' frame is stale and
// claiming "Saved" would mislead the user.
export function saveStatusState({ status, isConnected }: SaveStatusInputs): SaveStatusState {
    if (!isConnected) return 'offline'
    if (status === 'failed') return 'failed'
    return 'saved'
}

export const saveStatusLabel: Record<SaveStatusState, string> = {
    saved: 'Saved',
    failed: 'Save failed',
    offline: 'Offline',
}
