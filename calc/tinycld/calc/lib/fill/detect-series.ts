import type { ClipboardCell } from '../clipboard/types'
import type { CellRaw } from '../workbook-types'

// Pattern detection for the fill handle. Given a 1D slice of source
// cells (already linearized in the drag direction), classify the
// pattern so the commit path can extrapolate beyond the source.
//
// Detection rules apply in order; the first match wins. The bright
// line for "linear" is *constant* arithmetic delta between consecutive
// cells — we never extrapolate non-constant steps (1,3,9 → copy, not
// geometric). Single-cell numeric/date returns `copy` to match Sheets,
// which doesn't extrapolate from a single point. Single-cell
// suffix-int IS extrapolated ("Foo 1" → "Foo 2","Foo 3") because the
// intent is unambiguous.
//
// Mixed-kind sources, or strings that don't all match the same family
// (suffix-int / month / weekday), fall back to `copy` — replaying the
// source cycle modulo length.
//
// For month/weekday: detection is case-insensitive, but the source's
// case-pattern is preserved at projection time. If the source mixes
// case patterns ("Jan","FEB"), fall back to `copy` rather than
// guessing.

export type SeriesPlan =
    | { kind: 'copy' }
    | { kind: 'linear-number'; start: number; step: number }
    | { kind: 'linear-date'; startMs: number; stepMs: number }
    | { kind: 'linear-formula' }
    | { kind: 'suffix-int'; prefix: string; start: number; step: number; pad: number }
    | { kind: 'month'; startIdx: number; step: number; long: boolean; casing: NameCasing }
    | { kind: 'weekday'; startIdx: number; step: number; long: boolean; casing: NameCasing }

export type NameCasing = 'lower' | 'upper' | 'title'

const MONTHS_LONG = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
]

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Mon=0 to match the plan's documented index (consistent with the
// projection wrap test "weekday startIdx:0, stepIndex:7 → Mon").
const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const SUFFIX_INT_RE = /^(.*?)(-?\d+)$/

export function detectSeries(source: ClipboardCell[]): SeriesPlan {
    if (source.length === 0) return { kind: 'copy' }

    if (allEmpty(source)) return { kind: 'copy' }

    if (hasMixedKinds(source)) return { kind: 'copy' }

    const firstNonEmpty = source.find((c) => !isEmpty(c))
    if (firstNonEmpty == null) return { kind: 'copy' }

    const kind = firstNonEmpty.kind

    if (kind === 'number') {
        return detectLinearNumber(source)
    }

    if (kind === 'date') {
        return detectLinearDate(source)
    }

    if (kind === 'formula') {
        return detectLinearFormula(source)
    }

    if (kind === 'string') {
        return detectStringSeries(source)
    }

    return { kind: 'copy' }
}

// projectSeries returns the cell value for a destination at `stepIndex`
// past the source's start. `stepIndex = 0` corresponds to source[0];
// `stepIndex = source.length` is the first post-source destination.
//
// For `linear-formula`, we return the source formula verbatim (cycling
// modulo source length). The commit path in apply-fill.ts is responsible
// for overlaying `rewriteFormula` with the per-destination (deltaRow,
// deltaCol) — the projection function has no destination knowledge.
//
// Style is never projected by this function; the commit path copies
// style separately by cycling source styles modulo length.
export function projectSeries(
    plan: SeriesPlan,
    sourceCells: ClipboardCell[],
    stepIndex: number
): ClipboardCell {
    if (plan.kind === 'copy') {
        const cycled = sourceCells[stepIndex % sourceCells.length]
        return cloneValue(cycled)
    }

    if (plan.kind === 'linear-number') {
        const value = plan.start + plan.step * stepIndex
        return { kind: 'number', raw: value }
    }

    if (plan.kind === 'linear-date') {
        const ms = plan.startMs + plan.stepMs * stepIndex
        const iso = new Date(ms).toISOString().slice(0, 10)
        return { kind: 'date', raw: iso }
    }

    if (plan.kind === 'linear-formula') {
        const src = sourceCells[stepIndex % sourceCells.length]
        return { kind: 'formula', raw: null, formula: src.formula }
    }

    if (plan.kind === 'suffix-int') {
        const value = plan.start + plan.step * stepIndex
        const digits = String(Math.abs(value))
        const sign = value < 0 ? '-' : ''
        const padded = digits.length >= plan.pad ? digits : digits.padStart(plan.pad, '0')
        return { kind: 'string', raw: `${plan.prefix}${sign}${padded}` }
    }

    if (plan.kind === 'month') {
        const idx = mod(plan.startIdx + plan.step * stepIndex, 12)
        const name = (plan.long ? MONTHS_LONG : MONTHS_SHORT)[idx]
        return { kind: 'string', raw: applyCasing(name, plan.casing) }
    }

    // plan.kind === 'weekday'
    const idx = mod(plan.startIdx + plan.step * stepIndex, 7)
    const name = (plan.long ? WEEKDAYS_LONG : WEEKDAYS_SHORT)[idx]
    return { kind: 'string', raw: applyCasing(name, plan.casing) }
}

function cloneValue(cell: ClipboardCell): ClipboardCell {
    return {
        kind: cell.kind,
        raw: cell.raw,
        formula: cell.formula,
    }
}

function isEmpty(cell: ClipboardCell): boolean {
    return cell.kind === 'string' && cell.raw === ''
}

function allEmpty(source: ClipboardCell[]): boolean {
    return source.every(isEmpty)
}

function hasMixedKinds(source: ClipboardCell[]): boolean {
    const nonEmpty = source.filter((c) => !isEmpty(c))
    if (nonEmpty.length < 2) return false
    const first = nonEmpty[0].kind
    return nonEmpty.some((c) => c.kind !== first)
}

function detectLinearNumber(source: ClipboardCell[]): SeriesPlan {
    if (source.length < 2) return { kind: 'copy' }
    const numbers = source.map((c) => (typeof c.raw === 'number' ? c.raw : Number.NaN))
    if (numbers.some(Number.isNaN)) return { kind: 'copy' }
    const step = numbers[1] - numbers[0]
    for (let i = 2; i < numbers.length; i++) {
        if (numbers[i] - numbers[i - 1] !== step) return { kind: 'copy' }
    }
    return { kind: 'linear-number', start: numbers[0], step }
}

function detectLinearDate(source: ClipboardCell[]): SeriesPlan {
    if (source.length < 2) return { kind: 'copy' }
    const times = source.map((c) => parseDateMs(c.raw))
    if (times.some((t) => t == null)) return { kind: 'copy' }
    const step = (times[1] as number) - (times[0] as number)
    for (let i = 2; i < times.length; i++) {
        if ((times[i] as number) - (times[i - 1] as number) !== step) return { kind: 'copy' }
    }
    return { kind: 'linear-date', startMs: times[0] as number, stepMs: step }
}

function parseDateMs(raw: CellRaw): number | null {
    if (typeof raw !== 'string') return null
    const t = new Date(raw).getTime()
    return Number.isFinite(t) ? t : null
}

function detectLinearFormula(source: ClipboardCell[]): SeriesPlan {
    if (source.some((c) => c.kind !== 'formula' || c.formula == null)) return { kind: 'copy' }
    return { kind: 'linear-formula' }
}

function detectStringSeries(source: ClipboardCell[]): SeriesPlan {
    const strings = source.map((c) => (typeof c.raw === 'string' ? c.raw : ''))
    if (strings.some((s) => s === '')) return { kind: 'copy' }

    const suffix = detectSuffixInt(strings)
    if (suffix != null) return suffix

    const month = detectNameSeries(strings, MONTHS_LONG, MONTHS_SHORT, 'month')
    if (month != null) return month

    const weekday = detectNameSeries(strings, WEEKDAYS_LONG, WEEKDAYS_SHORT, 'weekday')
    if (weekday != null) return weekday

    return { kind: 'copy' }
}

interface SuffixIntMatch {
    prefix: string
    int: number
    digitCount: number
    naturalCount: number
}

function detectSuffixInt(strings: string[]): SeriesPlan | null {
    const matches: SuffixIntMatch[] = []
    for (const s of strings) {
        const m = SUFFIX_INT_RE.exec(s)
        if (m == null) return null
        const intStr = m[2]
        // digit-count for padding excludes the sign, so "-09" pads as 2 wide.
        const digitCount = intStr.replace(/^-/, '').length
        const naturalCount = String(Math.abs(Number(intStr))).length
        matches.push({ prefix: m[1], int: Number(intStr), digitCount, naturalCount })
    }
    const prefix = matches[0].prefix
    if (matches.some((m) => m.prefix !== prefix)) return null

    if (matches.length < 2) {
        return {
            kind: 'suffix-int',
            prefix,
            start: matches[0].int,
            step: 1,
            pad: padForMatches(matches),
        }
    }

    const step = matches[1].int - matches[0].int
    for (let i = 2; i < matches.length; i++) {
        if (matches[i].int - matches[i - 1].int !== step) return null
    }
    return {
        kind: 'suffix-int',
        prefix,
        start: matches[0].int,
        step,
        pad: padForMatches(matches),
    }
}

// pad rule: when every source value is padded (digitCount > naturalCount),
// preserve the min digit-count so projection keeps the leading zeros
// ("008","009" → "010"). When any source value is at natural width
// (already outgrew its padding), drop padding to the smallest natural
// width so subsequent projections aren't artificially padded
// ("09","10" → "11", not "11" with leading zero).
function padForMatches(matches: SuffixIntMatch[]): number {
    const allPadded = matches.every((m) => m.digitCount > m.naturalCount)
    if (allPadded) {
        return matches.reduce((acc, m) => Math.min(acc, m.digitCount), matches[0].digitCount)
    }
    return matches.reduce((acc, m) => Math.min(acc, m.naturalCount), matches[0].naturalCount)
}

function detectNameSeries(
    strings: string[],
    longNames: string[],
    shortNames: string[],
    kind: 'month' | 'weekday'
): SeriesPlan | null {
    const longLower = longNames.map((n) => n.toLowerCase())
    const shortLower = shortNames.map((n) => n.toLowerCase())

    const firstLower = strings[0].toLowerCase()
    const firstIsLong = longLower.includes(firstLower)
    const firstIsShort = shortLower.includes(firstLower)
    if (!firstIsLong && !firstIsShort) return null

    const long = firstIsLong
    const lowerNames = long ? longLower : shortLower

    const indices: number[] = []
    const casings: NameCasing[] = []
    for (const s of strings) {
        const lower = s.toLowerCase()
        const idx = lowerNames.indexOf(lower)
        if (idx === -1) return null
        const casing = detectCasing(s)
        if (casing == null) return null
        indices.push(idx)
        casings.push(casing)
    }

    const casing = casings[0]
    if (casings.some((c) => c !== casing)) return null

    const wrap = long ? longNames.length : shortNames.length

    if (indices.length < 2) {
        const plan = {
            startIdx: indices[0],
            step: 1,
            long,
            casing,
        }
        return kind === 'month' ? { kind: 'month', ...plan } : { kind: 'weekday', ...plan }
    }

    const step = wrappedDelta(indices[0], indices[1], wrap)
    for (let i = 2; i < indices.length; i++) {
        if (wrappedDelta(indices[i - 1], indices[i], wrap) !== step) return null
    }

    const plan = { startIdx: indices[0], step, long, casing }
    return kind === 'month' ? { kind: 'month', ...plan } : { kind: 'weekday', ...plan }
}

function wrappedDelta(from: number, to: number, wrap: number): number {
    // Smallest positive forward step modulo `wrap`. (Dec→Jan reads as
    // step 1, not -11.) Returns 0 if from === to (constant series).
    return ((to - from) % wrap + wrap) % wrap
}

function detectCasing(s: string): NameCasing | null {
    if (s === s.toLowerCase()) return 'lower'
    if (s === s.toUpperCase()) return 'upper'
    // Title-case: first char upper, rest lower.
    if (s[0] === s[0].toUpperCase() && s.slice(1) === s.slice(1).toLowerCase()) return 'title'
    return null
}

function applyCasing(name: string, casing: NameCasing): string {
    if (casing === 'lower') return name.toLowerCase()
    if (casing === 'upper') return name.toUpperCase()
    return name
}

function mod(n: number, m: number): number {
    return ((n % m) + m) % m
}
