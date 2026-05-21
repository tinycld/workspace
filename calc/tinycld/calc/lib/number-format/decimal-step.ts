// stepDecimals derives a new numFmt pattern from `numFmt` with the
// decimal-place count adjusted by `delta` (+1 or -1). It is the engine
// behind the toolbar's `.0` and `.00` shortcut buttons.
//
// The pattern manipulation is intentionally narrow: it only mutates a
// single `.0+` run that is unambiguously in the "fractional" position
// of a simple `#,##0`-style mass. Patterns that look unfamiliar (the
// accounting pattern's `_($* #,##0.00_);…`, custom strings, `[h]:mm:ss`
// time codes, etc.) are returned unchanged so we don't accidentally
// produce a malformed numFmt.
//
// Rules:
//   - `numFmt` is undefined and delta = +1 → seed `#,##0.0`
//   - `numFmt` is undefined and delta = -1 → return undefined (no-op)
//   - Pattern contains a single `.0+` run not preceded by `%`, `[`, or
//     other separator and followed by either nothing, a `%`, or the
//     end of the integer-part: bump the run by ±1 zero. When the run
//     becomes empty (delta = -1 strips the last `0`), drop the dot.
//   - Pattern has no `.0+` run but does contain a trailing `%` or ends
//     in `0` and delta = +1: insert `.0` before the trailing `%` or at
//     the very end. (Covers `0%` → `0.0%`, `#,##0` → `#,##0.0`.)
//   - Anything else: return the input unchanged.
export function stepDecimals(numFmt: string | undefined, delta: 1 | -1): string | undefined {
    if (numFmt == null || numFmt === '') {
        return delta > 0 ? '#,##0.0' : undefined
    }

    if (!isSimplePattern(numFmt)) {
        return numFmt
    }

    const match = /\.(0+)/.exec(numFmt)
    if (match != null) {
        const run = match[1]
        const start = match.index
        if (delta > 0) {
            return `${numFmt.slice(0, start)}.${run}0${numFmt.slice(start + 1 + run.length)}`
        }
        if (run.length === 1) {
            return numFmt.slice(0, start) + numFmt.slice(start + 2)
        }
        return `${numFmt.slice(0, start)}.${run.slice(0, -1)}${numFmt.slice(start + 1 + run.length)}`
    }

    if (delta < 0) {
        return numFmt
    }
    if (numFmt.endsWith('%')) {
        return `${numFmt.slice(0, -1)}.0%`
    }
    if (/0$/.test(numFmt)) {
        return `${numFmt}.0`
    }
    return numFmt
}

// isSimplePattern recognises the small subset of numFmts where
// pattern manipulation is safe: optional currency prefix, an integer
// mass, an optional fractional run, and an optional `%` suffix. The
// accounting pattern (with `_(`, `* `, `;` segments, brackets) and
// date/time patterns are explicitly excluded.
function isSimplePattern(s: string): boolean {
    return /^[$£¥€]?[#,0]+(?:\.0+)?%?$/.test(s)
}
