import { useHelpStore } from './store'
import type { HelpTopicId } from './types'

// Imperative open. Use from event handlers, link click interceptors, or any
// non-React context. TODO(help-analytics): emit a telemetry event from here
// once we have a hook for it.
export function openHelp(id: HelpTopicId) {
    useHelpStore.getState().open(id)
}

// Opens the help drawer in package-index mode, showing every topic
// for the given package as a browsable list. Selecting a topic from
// that list transitions the drawer to topic mode with a back arrow.
export function openHelpPackage(slug: string) {
    useHelpStore.getState().openPackage(slug)
}

export function closeHelp() {
    useHelpStore.getState().close()
}
