export type Scope = 'global' | 'list' | 'thread' | 'compose' | 'modal'

export interface ShortcutEvent {
    keys: string
}

export interface Shortcut {
    id: string
    keys: string
    scope: Scope
    description: string
    group?: string
    allowInInputs?: boolean
    when?: () => boolean
    run: (e: ShortcutEvent) => void
}
