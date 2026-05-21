import { create } from '@tinycld/core/lib/store'

// useConditionalFormatVersionStore exposes a single monotonically-
// increasing counter that components can subscribe to to invalidate
// memoized custom-formula evaluations. The FormulaBridge bumps it on
// every HyperFormula `valuesUpdated` event — coarse-grained, but
// correct: any dependency of any rule's formula has just changed.
//
// Cells that don't sit inside a custom-formula rule don't subscribe,
// so the broadcast is free for them.
interface CFVersionState {
    version: number
    bump(): void
}

export const useConditionalFormatVersionStore = create<CFVersionState>((set) => ({
    version: 0,
    bump: () => set((s) => ({ version: s.version + 1 })),
}))

export function bumpConditionalFormatVersion(): void {
    useConditionalFormatVersionStore.getState().bump()
}
