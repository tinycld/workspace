import { useEffect } from 'react'
import { Platform } from 'react-native'
import { useHelpSearchStore } from './search-store'

// Bind ⌘/ (Mac) / Ctrl+/ (Win/Linux) → open the help palette. Web-only
// — native has no equivalent keyboard surface and the palette itself is
// .web.tsx. Listens at the document level so the shortcut reaches the
// user even when an editor surface has focus; help should never be more
// than one keystroke away.
export function useHelpSearchShortcut() {
    useEffect(() => {
        if (Platform.OS !== 'web' || typeof document === 'undefined') return
        const onKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === '/') {
                e.preventDefault()
                useHelpSearchStore.getState().toggle()
            }
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    }, [])
}
