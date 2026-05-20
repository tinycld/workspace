export const PII_KEY_PATTERN = /email|body|subject|name|phone|address|content|filename|title/i

const FILTERED = '[Filtered]'
const CIRCULAR = '[Circular]'

export function scrubPII<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
    if (value === null || value === undefined) return value
    if (typeof value !== 'object') return value

    const obj = value as unknown as object
    if (seen.has(obj)) {
        return CIRCULAR as unknown as T
    }
    seen.add(obj)

    if (Array.isArray(value)) {
        return value.map(item => scrubPII(item, seen)) as unknown as T
    }

    const out: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        if (PII_KEY_PATTERN.test(key)) {
            out[key] = FILTERED
        } else {
            out[key] = scrubPII(inner, seen)
        }
    }
    return out as unknown as T
}
