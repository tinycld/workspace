import type { FilePreviewSource, PreviewAction } from './types'

/**
 * A "factory hook" — called from React rendering so it can use other hooks
 * (mutations, context, etc.) and returns a ready-to-use PreviewAction.
 */
export type PreviewActionFactory = () => PreviewAction

const factories = new Map<string, PreviewActionFactory>()

/**
 * Register a PreviewAction factory by ID. Calling this with the same ID
 * twice replaces the previous registration (so the most recently linked
 * package wins). Designed to be called at module load — typically from
 * a package's provider.
 */
export function registerPreviewAction(id: string, factory: PreviewActionFactory) {
    factories.set(id, factory)
}

export function unregisterPreviewAction(id: string) {
    factories.delete(id)
}

/**
 * Returns the registered factories in insertion order. Consumers (e.g. the
 * mail thread screen) call this from a React component, invoke each factory
 * to obtain hook results, and pass the resulting PreviewAction[] into the
 * PreviewModal.
 */
export function getPreviewActionFactories(): PreviewActionFactory[] {
    return Array.from(factories.values())
}

export function __resetPreviewActionRegistryForTests() {
    factories.clear()
}

export type { FilePreviewSource, PreviewAction }
