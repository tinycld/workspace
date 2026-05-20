import type { PreviewRegistryEntry } from './types'

const registry = new Map<string, PreviewRegistryEntry>()

export function registerPreview(pattern: string, entry: PreviewRegistryEntry) {
    registry.set(pattern, entry)
}

export function getPreviewEntry(mimeType: string): PreviewRegistryEntry | undefined {
    const exact = registry.get(mimeType)
    if (exact) return exact

    const wildcard = `${mimeType.split('/')[0]}/*`
    const wildcardEntry = registry.get(wildcard)
    if (wildcardEntry) return wildcardEntry

    return registry.get('*')
}

/** Test-only: drop all registrations. */
export function __resetRegistryForTests() {
    registry.clear()
}
