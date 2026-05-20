// Tinykeys ships types at dist/tinykeys.d.ts but its package.json "exports"
// field omits a "types" condition, so bundler module resolution cannot pick
// them up. Re-declare the narrow surface we rely on.
declare module 'tinykeys' {
    export interface KeyBindingMap {
        [keybinding: string]: (event: KeyboardEvent) => void
    }
    export interface KeyBindingOptions {
        timeout?: number
        event?: 'keydown' | 'keyup'
        capture?: boolean
    }
    export function tinykeys(
        target: Window | HTMLElement,
        keyBindingMap: KeyBindingMap,
        options?: KeyBindingOptions
    ): () => void
}
