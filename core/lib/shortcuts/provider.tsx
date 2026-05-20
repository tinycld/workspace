// Base module for TypeScript resolution. Metro picks provider.web.tsx on web
// and provider.native.tsx on iOS/Android at bundle time.
import type { ReactNode } from 'react'

export interface ShortcutsProviderProps {
    children: ReactNode
}

export function ShortcutsProvider(_props: ShortcutsProviderProps): ReactNode {
    throw new Error(
        'ShortcutsProvider base module should never run — Metro should resolve a .web or .native override'
    )
}
