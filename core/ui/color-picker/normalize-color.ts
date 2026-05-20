// normalizeColor handles excelize-style hex colors. Excelize stores
// colors as "AARRGGBB" (8 hex digits, alpha first) or "RRGGBB" (no
// alpha). Both need conversion: 6-digit form prepends `#`; 8-digit
// opaque (AA=FF) drops the alpha; 8-digit non-opaque converts to
// `rgba(R,G,B,A)` because CSS uses `#RRGGBBAA` byte order, not Excel's
// `#AARRGGBB` — emitting `#80FF0000` from Excel's red-at-50%-opacity
// would render in browsers as a translucent teal.
export function normalizeColor(value: string): string {
    if (value.startsWith('#')) return value
    const upper = value.toUpperCase()
    if (/^[0-9A-F]{8}$/.test(upper)) {
        const a = upper.slice(0, 2)
        const rgb = upper.slice(2)
        if (a === 'FF') {
            return `#${rgb}`
        }
        const alpha = Number.parseInt(a, 16) / 255
        const r = Number.parseInt(rgb.slice(0, 2), 16)
        const g = Number.parseInt(rgb.slice(2, 4), 16)
        const b = Number.parseInt(rgb.slice(4, 6), 16)
        return `rgba(${r},${g},${b},${alpha.toFixed(3)})`
    }
    if (/^[0-9A-F]{6}$/.test(upper)) {
        return `#${upper}`
    }
    return value
}
