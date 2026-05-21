/**
 * If `name` is already in `used`, append " (1)", " (2)", … before the extension.
 * Mirrors the behavior in drive's primary upload pipeline. Exported as its
 * own pure module so unit tests can import it without dragging react-native
 * into vitest's transform pipeline.
 */
export function deduplicateName(name: string, used: Set<string>): string {
    if (!used.has(name)) return name

    const dotIdx = name.lastIndexOf('.')
    const base = dotIdx > 0 ? name.slice(0, dotIdx) : name
    const ext = dotIdx > 0 ? name.slice(dotIdx) : ''

    for (let counter = 1; counter <= 999; counter++) {
        const candidate = `${base} (${counter})${ext}`
        if (!used.has(candidate)) return candidate
    }
    return `${base} (${Date.now()})${ext}`
}
