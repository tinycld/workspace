import { type CellKind, type CellRaw, formatCell } from './workbook-types'

// InferredCellInput is the structured result of running raw editor
// text through inferCellInput. The editor commit path turns the
// user's typed string into one of these and hands it to
// setYCellTyped, which writes the right kind/raw/display/formula
// fields to the Y.Doc.
export interface InferredCellInput {
    kind: CellKind
    raw: CellRaw
    display: string
    formula?: string
}

// inferCellInput classifies the text the user typed in the editor.
// Rules apply in order; the first match wins. The rules are
// locale-strict on purpose: dates are ISO-only, numbers don't accept
// thousands separators, booleans are exact-match TRUE/FALSE. This
// keeps the doc portable — locale-specific *display* formatting is a
// numFmt concern, not a value concern.
//
// Empty input is signalled by returning kind 'string' with raw '';
// callers that care about the empty-cell semantics (the editor commit
// path) check for this and delete the cell.
export function inferCellInput(text: string): InferredCellInput {
    if (text === '') {
        return { kind: 'string', raw: '', display: '' }
    }

    // 1. Apostrophe prefix forces string. Strip the prefix; the rest
    //    is taken as-is, even if it would otherwise look like a
    //    number / date / formula.
    if (text.startsWith("'")) {
        const literal = text.slice(1)
        return { kind: 'string', raw: literal, display: literal }
    }

    // 2. Equals prefix means formula. raw stays null until an
    //    evaluator caches a value; display falls back to the formula
    //    text so the cell renders something while no evaluator runs.
    if (text.startsWith('=')) {
        return { kind: 'formula', raw: null, display: text, formula: text }
    }

    // 3. Booleans match TRUE/FALSE case-insensitively after a trim,
    //    so trailing whitespace doesn't flip kind.
    const trimmed = text.trim()
    const upper = trimmed.toUpperCase()
    if (upper === 'TRUE' || upper === 'FALSE') {
        const b = upper === 'TRUE'
        return { kind: 'boolean', raw: b, display: formatCell('boolean', b) }
    }

    // 4. ISO date — yyyy-mm-dd, optionally with a time. Validate by
    //    constructing a Date (catches "2024-13-40" etc.).
    if (ISO_DATE_RE.test(trimmed)) {
        const parsed = new Date(trimmed)
        if (!Number.isNaN(parsed.getTime())) {
            // Re-emit as canonical ISO so the on-disk form is
            // identical regardless of the input format.
            const iso = canonicalizeIsoDate(trimmed, parsed)
            return { kind: 'date', raw: iso, display: iso }
        }
    }

    // 5. Number — strict regex (no thousands separators, no leading
    //    or trailing whitespace post-trim, optional sign and
    //    exponent). parseFloat alone is too lenient ("12abc" → 12),
    //    so the regex pre-gates and we only call parseFloat on
    //    matches.
    if (NUMBER_RE.test(trimmed)) {
        const n = Number(trimmed)
        if (Number.isFinite(n)) {
            return { kind: 'number', raw: n, display: formatCell('number', n) }
        }
    }

    // 6. Anything else is a string. raw is the text the user typed
    //    verbatim (no trim — leading/trailing space is preserved for
    //    string cells, matching Excel).
    return { kind: 'string', raw: text, display: text }
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?)?$/
const NUMBER_RE = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/

function canonicalizeIsoDate(input: string, parsed: Date): string {
    // Date-only inputs (no T) round-trip as yyyy-mm-dd. Anything
    // with a time component re-emits as full ISO. The parsed Date
    // is the source of truth so timezone offsets normalize to UTC.
    if (!input.includes('T')) {
        return parsed.toISOString().slice(0, 10)
    }
    return parsed.toISOString()
}
