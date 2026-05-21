import { dateToSerial, format as numfmtFormat } from 'numfmt'
import type { CellKind, CellRaw } from '../workbook-types'

// applyNumFmt is the kind+numFmt-aware display formatter. It is the
// new heart of formatCell() — when the cell carries a numFmt pattern,
// route through `numfmt`; when it doesn't, fall back to the kind-only
// defaults that shipped before format support landed.
//
// Pattern semantics:
//   - undefined / null → no format, use the kind-aware default. This
//     is the "Automatic" preset and matches every cell in the doc
//     today (since no UI has ever written numFmt).
//   - '@' → plain text. Numbers / dates / booleans render as-is via
//     the default path — '@' is the "treat this as text, don't
//     reformat numerics" mode in Excel. Calling numfmt with '@' on
//     a string would also work, but on a number it would still emit
//     the number (numfmt treats unmatched patterns as literal). We
//     short-circuit so the round-trip stays predictable: a Number
//     cell formatted as Plain text shows the typed digits, not a
//     re-formatted version.
//   - any other pattern → handed to numfmt.format with a
//     kind-appropriate input value.
//
// Kind dispatch when numFmt is set:
//   - number → pass the number through
//   - boolean → coerce to TRUE/FALSE the same way the default path
//     would; no useful number format applies to a bool, so we just
//     emit the boolean's text. (numfmt's own boolean handling is
//     locale-tied and emits TRUE/FALSE as well, but going through it
//     for a bool just to land in the same place is overhead.)
//   - date → ISO string → [y, m, d, ...] components → dateToSerial.
//     Bypassing JS Date avoids timezone shifting an "ISO date-only"
//     into the previous day in a UTC-negative environment.
//   - formula → if the formula's cached raw is numeric, treat as
//     number; if string, treat as string; if boolean, emit
//     TRUE/FALSE; if null (no cached value yet), fall back to the
//     formula text via the default path.
//   - string → no numeric format applies; pass through.
export function applyNumFmt(
    kind: CellKind,
    raw: CellRaw | Date,
    numFmt: string | undefined,
    formula?: string
): string {
    if (numFmt == null || numFmt === '') {
        return defaultFormat(kind, raw, formula)
    }
    if (numFmt === '@') {
        // "Plain text" — render whatever the kind would naturally
        // render, with no number format applied.
        return defaultFormat(kind, raw, formula)
    }

    const value = toFormatInput(kind, raw, formula)
    if (value === undefined) {
        return defaultFormat(kind, raw, formula)
    }
    return numfmtFormat(numFmt, value)
}

// toFormatInput converts a typed (kind, raw) pair to the value type
// numfmt.format expects: numbers stay numbers, dates become Excel
// serials, etc. Returns undefined when there's nothing meaningful to
// hand to numfmt — the caller then falls back to defaultFormat (which
// renders e.g. "" for a null-raw cell).
function toFormatInput(kind: CellKind, raw: CellRaw | Date, formula?: string): unknown | undefined {
    if (raw == null && kind !== 'formula') return undefined
    switch (kind) {
        case 'number':
            return typeof raw === 'number' ? raw : undefined
        case 'boolean':
            return typeof raw === 'boolean' ? raw : undefined
        case 'date':
            return dateRawToSerial(raw)
        case 'string':
            return typeof raw === 'string' ? raw : undefined
        case 'formula':
            // No cached value yet — let defaultFormat surface the
            // formula text.
            if (raw == null) return formula != null ? undefined : undefined
            if (typeof raw === 'number' || typeof raw === 'boolean' || typeof raw === 'string')
                return raw
            return undefined
    }
}

// dateRawToSerial accepts both the on-disk string form (ISO,
// produced by inferCellInput / toYRaw) and a JS Date (the in-memory
// form some upstream parsers hand us). Returns the Excel serial
// number for the date — the form numfmt.format wants for a date
// pattern.
//
// ISO date-only strings ("2024-01-15") are split into [y, m, d] so
// dateToSerial doesn't go through JS Date (which would shift the
// day in negative UTC offsets).
function dateRawToSerial(raw: CellRaw | Date): number | undefined {
    if (raw instanceof Date) {
        // dateToSerial reads JS Date in local time, which shifts
        // midnight-UTC dates back by one day in negative offsets. For
        // dates whose UTC time component is zero (the upstream's
        // "date-only" form), pull the UTC year/month/day out and pass
        // as components so the rendered date matches the ISO input.
        if (
            raw.getUTCHours() === 0 &&
            raw.getUTCMinutes() === 0 &&
            raw.getUTCSeconds() === 0 &&
            raw.getUTCMilliseconds() === 0
        ) {
            return nullToUndefined(
                dateToSerial([raw.getUTCFullYear(), raw.getUTCMonth() + 1, raw.getUTCDate()])
            )
        }
        return nullToUndefined(dateToSerial(raw))
    }
    if (typeof raw !== 'string' || raw === '') return undefined
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
    if (dateOnly != null) {
        const y = Number(dateOnly[1])
        const m = Number(dateOnly[2])
        const d = Number(dateOnly[3])
        return nullToUndefined(dateToSerial([y, m, d]))
    }
    // Has a time component — go through Date so the time portion
    // round-trips. Timezone shifting is acceptable here (the input
    // explicitly carries a time, so the user already chose an
    // instant-in-time interpretation).
    const parsed = new Date(raw)
    if (Number.isNaN(parsed.getTime())) return undefined
    return nullToUndefined(dateToSerial(parsed))
}

// dateToSerial returns null for unparseable inputs (out-of-range dates,
// nonsensical components). Map that to undefined so the callers can
// fall back to defaultFormat without touching numfmt.
function nullToUndefined(n: number | null): number | undefined {
    return n == null ? undefined : n
}

// defaultFormat is the kind-aware fallback path — what formatCell did
// before numFmt landed. Identical behavior to the prior implementation
// in workbook-types.ts (kept here so the format module is the single
// dispatch point and the workbook-types module stays a pure data
// definition).
export function defaultFormat(kind: CellKind, raw: CellRaw | Date, formula?: string): string {
    if (kind === 'formula') {
        if (raw == null) return formula ?? ''
        if (typeof raw === 'string') return raw
        if (typeof raw === 'number') return defaultNumber(raw)
        if (typeof raw === 'boolean') return raw ? 'TRUE' : 'FALSE'
        if (raw instanceof Date) return defaultDate(raw)
        return String(raw)
    }
    if (raw == null) return ''
    switch (kind) {
        case 'string':
            return typeof raw === 'string' ? raw : String(raw)
        case 'number':
            if (typeof raw === 'number') return defaultNumber(raw)
            return String(raw)
        case 'boolean':
            return raw ? 'TRUE' : 'FALSE'
        case 'date':
            if (raw instanceof Date) return defaultDate(raw)
            if (typeof raw === 'string') return raw
            return String(raw)
    }
}

function defaultNumber(n: number): string {
    if (!Number.isFinite(n)) return String(n)
    return Number.isInteger(n) ? String(n) : n.toString()
}

function defaultDate(d: Date): string {
    if (
        d.getUTCHours() === 0 &&
        d.getUTCMinutes() === 0 &&
        d.getUTCSeconds() === 0 &&
        d.getUTCMilliseconds() === 0
    ) {
        return d.toISOString().slice(0, 10)
    }
    return d.toISOString()
}
