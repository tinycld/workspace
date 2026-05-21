// Pure helpers powering the formula function autocomplete dropdown.
// Given the current draft text + cursor position, parseFunctionToken
// decides whether the user is typing a function name; filterFunctions
// narrows a function list by case-insensitive prefix; and
// applyFunctionInsertion replaces the in-progress token with the chosen
// name plus an open paren, returning the new draft and cursor.

export interface FunctionToken {
    token: string
    tokenStart: number
    tokenEnd: number
}

export interface DraftSelection {
    start: number
    end: number
}

const FN_CHAR = /[A-Za-z_]/
const FN_CONTINUE = /[A-Za-z0-9_.]/

// parseFunctionToken returns the function-name token under the cursor,
// or null when the cursor isn't sitting in one. Rules:
//   - draft must start with '='
//   - cursor must not be inside a string literal ("...")
//   - the token under the cursor is a contiguous run of [A-Za-z_]
//     followed by [A-Za-z0-9_.] characters; the cursor sits anywhere
//     between tokenStart and tokenEnd inclusive
//   - the token must start with a letter or underscore (so digits don't
//     trigger autocomplete mid-number)
export function parseFunctionToken(draft: string, cursor: number): FunctionToken | null {
    if (!draft.startsWith('=')) return null
    if (cursor < 1 || cursor > draft.length) return null
    if (isInsideStringLiteral(draft, cursor)) return null

    let start = cursor
    while (start > 1 && FN_CONTINUE.test(draft[start - 1])) start--
    if (start === cursor) {
        // Cursor must be at the end of (or inside) a token. If the char
        // immediately to the left isn't a function-continuing char, no
        // token is being typed.
        return null
    }
    if (!FN_CHAR.test(draft[start])) return null

    let end = cursor
    while (end < draft.length && FN_CONTINUE.test(draft[end])) end++

    const token = draft.slice(start, end)
    if (token.length === 0) return null
    return { token, tokenStart: start, tokenEnd: end }
}

// isInsideStringLiteral counts unescaped double quotes from the start
// of the draft up to (but not including) the cursor position. Odd
// count = inside a string. The formula language uses doubled quotes
// ("") to escape a literal quote inside a string, which keeps the
// running count even — same logic Excel uses.
function isInsideStringLiteral(draft: string, cursor: number): boolean {
    let inside = false
    for (let i = 0; i < cursor; i++) {
        if (draft[i] !== '"') continue
        if (inside && draft[i + 1] === '"') {
            i++
            continue
        }
        inside = !inside
    }
    return inside
}

// filterFunctions returns up to `limit` function names that start with
// the given prefix (case-insensitive), sorted alphabetically. An empty
// prefix yields no results — the dropdown only opens once the user has
// typed at least one letter.
export function filterFunctions(names: readonly string[], prefix: string, limit = 8): string[] {
    if (prefix === '') return []
    const upper = prefix.toUpperCase()
    const matches: string[] = []
    for (const n of names) {
        if (n.toUpperCase().startsWith(upper)) matches.push(n)
        if (matches.length >= limit * 4) break
    }
    matches.sort()
    return matches.slice(0, limit)
}

// applyFunctionInsertion replaces the partial token at [tokenStart,
// tokenEnd) with `${fnName}(` and places the cursor just after the
// open paren. Mirrors what Excel/Sheets do — the user typed the
// prefix, picked a function, and lands ready to type arguments.
export function applyFunctionInsertion(
    draft: string,
    token: FunctionToken,
    fnName: string
): { draft: string; selection: DraftSelection } {
    const before = draft.slice(0, token.tokenStart)
    const after = draft.slice(token.tokenEnd)
    const insertion = `${fnName}(`
    const nextDraft = `${before}${insertion}${after}`
    const cursor = before.length + insertion.length
    return { draft: nextDraft, selection: { start: cursor, end: cursor } }
}
