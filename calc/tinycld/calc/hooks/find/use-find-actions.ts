import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import { useCallback, useEffect, useMemo } from 'react'
import type * as Y from 'yjs'
import { parseYCellKey, yCellKey } from '../../lib/y-cell-key'
import { CELLS_MAP, readYCell } from '../../lib/y-doc-bootstrap'
import { setYCell } from '../use-y-cell'
import type { FindMatch, FindStoreApi } from './use-find-store'

// useFindActions wires the find store to the Y.Doc. It re-scans for
// matches whenever the query, options, scope, sheet selection, or any
// observed cell changes; and exposes next/prev/replace/replaceAll
// callbacks the dialog (and shortcuts) invoke.

export interface FindActions {
    openFind: () => void
    openReplace: () => void
    close: () => void
    nextMatch: () => void
    prevMatch: () => void
    replaceCurrent: () => void
    replaceAll: () => void
}

export interface UseFindActionsArgs {
    doc: Y.Doc | null
    sheetId: string
    findStore: FindStoreApi
    readOnly?: boolean
}

export function useFindActions({
    doc,
    sheetId,
    findStore,
    readOnly = false,
}: UseFindActionsArgs): FindActions {
    // Recompute matches whenever the dialog is open AND
    //   - the query/options/scope change, or
    //   - cells in scope mutate (observed via the cells Y.Map), or
    //   - the active sheet changes (relevant only when scope='sheet').
    //
    // The store subscription compares an "inputs key" rather than
    // listening to every store update — otherwise setMatches would
    // re-trigger itself in an infinite loop.
    useEffect(() => {
        if (doc == null) return
        const recompute = () => {
            const s = findStore.getState()
            if (!s.isOpen) return
            const result = computeMatches(doc, {
                sheetId,
                query: s.query,
                matchCase: s.matchCase,
                wholeCell: s.wholeCell,
                useRegex: s.useRegex,
                searchInFormulas: s.searchInFormulas,
                scope: s.scope,
            })
            s.setMatches(result.matches, result.regexError)
        }
        recompute()
        const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
        const handler = () => recompute()
        cellsMap.observeDeep(handler)
        let prev = findInputsKey(findStore.getState())
        const unsub = findStore.subscribe(() => {
            const next = findInputsKey(findStore.getState())
            if (next !== prev) {
                prev = next
                recompute()
            }
        })
        return () => {
            cellsMap.unobserveDeep(handler)
            unsub()
        }
    }, [doc, sheetId, findStore])

    const openFind = useCallback(() => findStore.getState().open('find'), [findStore])
    const openReplace = useCallback(() => findStore.getState().open('replace'), [findStore])
    const close = useCallback(() => findStore.getState().close(), [findStore])

    const nextMatch = useCallback(() => {
        const s = findStore.getState()
        if (s.matches.length === 0) return
        s.setCurrentMatchIndex((s.currentMatchIndex + 1) % s.matches.length)
    }, [findStore])

    const prevMatch = useCallback(() => {
        const s = findStore.getState()
        if (s.matches.length === 0) return
        const i = s.currentMatchIndex <= 0 ? s.matches.length - 1 : s.currentMatchIndex - 1
        s.setCurrentMatchIndex(i)
    }, [findStore])

    const replaceCurrent = useCallback(() => {
        if (doc == null || readOnly) return
        const s = findStore.getState()
        const match = s.matches[s.currentMatchIndex]
        if (match == null) return
        const matcher = buildMatcher(s)
        if (matcher == null) return
        applyReplaceToCell(doc, match, matcher, s.replacement, s.searchInFormulas)
    }, [doc, findStore, readOnly])

    const replaceAll = useCallback(() => {
        if (doc == null || readOnly) return
        const s = findStore.getState()
        if (s.matches.length === 0) return
        const matcher = buildMatcher(s)
        if (matcher == null) return
        applyReplaceAll(doc, s.matches, matcher, s.replacement, s.searchInFormulas)
    }, [doc, findStore, readOnly])

    return useMemo(
        () => ({ openFind, openReplace, close, nextMatch, prevMatch, replaceCurrent, replaceAll }),
        [openFind, openReplace, close, nextMatch, prevMatch, replaceCurrent, replaceAll]
    )
}

interface MatchOptions {
    sheetId: string
    query: string
    matchCase: boolean
    wholeCell: boolean
    useRegex: boolean
    searchInFormulas: boolean
    scope: 'sheet' | 'workbook'
}

interface ComputeResult {
    matches: FindMatch[]
    regexError: string | null
}

// computeMatches walks the cells Y.Map and returns the sorted list of
// cells whose `display` (and optionally `formula`) match the query.
// Pulled out as a pure function so tests can drive it directly without
// mounting React.
export function computeMatches(doc: Y.Doc, opts: MatchOptions): ComputeResult {
    if (opts.query === '') {
        return { matches: [], regexError: null }
    }
    let regex: RegExp | null = null
    if (opts.useRegex) {
        try {
            regex = new RegExp(opts.query, opts.matchCase ? '' : 'i')
        } catch (err) {
            return { matches: [], regexError: errMessage(err) }
        }
    }
    const needle = opts.matchCase ? opts.query : opts.query.toLowerCase()
    const matchHay = (h: string): boolean => {
        if (regex != null) {
            if (opts.wholeCell) {
                // Whole-cell regex: avoid wrapping the user's pattern in
                // ^…$ (top-level alternation would silently mis-bind to
                // one branch). Run the pattern, require the match span
                // to equal the haystack.
                const m = h.match(regex)
                return m != null && m[0] === h
            }
            return regex.test(h)
        }
        const hay = opts.matchCase ? h : h.toLowerCase()
        return opts.wholeCell ? hay === needle : hay.includes(needle)
    }
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const matches: FindMatch[] = []
    cellsMap.forEach((cell, key) => {
        const parsed = parseYCellKey(key)
        if (parsed == null) return
        if (opts.scope === 'sheet' && parsed.sheetId !== opts.sheetId) return
        const value = readYCell(cell)
        if (matchHay(value.display)) {
            matches.push({ sheetId: parsed.sheetId, row: parsed.row, col: parsed.col })
            return
        }
        if (opts.searchInFormulas && value.formula != null && matchHay(value.formula)) {
            matches.push({ sheetId: parsed.sheetId, row: parsed.row, col: parsed.col })
        }
    })
    matches.sort(compareMatches)
    return { matches, regexError: null }
}

function compareMatches(a: FindMatch, b: FindMatch): number {
    if (a.sheetId !== b.sheetId) return a.sheetId < b.sheetId ? -1 : 1
    if (a.row !== b.row) return a.row - b.row
    return a.col - b.col
}

export interface CompiledMatcher {
    regex: RegExp | null
    needle: string
    matchCase: boolean
    wholeCell: boolean
    useRegex: boolean
}

export function buildMatcher(s: {
    query: string
    matchCase: boolean
    wholeCell: boolean
    useRegex: boolean
}): CompiledMatcher | null {
    if (s.query === '') return null
    let regex: RegExp | null = null
    if (s.useRegex) {
        try {
            regex = new RegExp(s.query, s.matchCase ? 'g' : 'gi')
        } catch {
            return null
        }
    }
    return {
        regex,
        needle: s.query,
        matchCase: s.matchCase,
        wholeCell: s.wholeCell,
        useRegex: s.useRegex,
    }
}

// applyReplaceAll replaces every match in one Y.Doc.transact so undo
// rolls back the whole operation in a single step. Pass `s.matches.slice()`
// when you need to ignore matches added by side-effects of intermediate
// writes.
export function applyReplaceAll(
    doc: Y.Doc,
    targets: FindMatch[],
    matcher: CompiledMatcher,
    replacement: string,
    searchInFormulas: boolean
): void {
    doc.transact(() => {
        for (const m of targets) {
            applyReplaceToCell(doc, m, matcher, replacement, searchInFormulas)
        }
    }, LOCAL_ORIGIN)
}

// For non-formula cells we run the replaced string through setYCell so
// the typed-cell pipeline re-infers kind (a number-shaped replacement
// promotes the cell back to 'number'). For formula cells we only touch
// the formula text when searchInFormulas is set; the engine
// re-evaluates via the formula bridge on the write.
export function applyReplaceToCell(
    doc: Y.Doc,
    match: FindMatch,
    matcher: CompiledMatcher,
    replacement: string,
    searchInFormulas: boolean
): void {
    const cellsMap = doc.getMap<Y.Map<unknown>>(CELLS_MAP)
    const cell = cellsMap.get(yCellKey(match.sheetId, match.row, match.col))
    if (cell == null) return
    const value = readYCell(cell)
    if (value.kind === 'formula' && searchInFormulas && value.formula != null) {
        const next = applyReplacement(value.formula, matcher, replacement)
        if (next === value.formula) return
        setYCell(doc, match.sheetId, match.row, match.col, next)
        return
    }
    const next = applyReplacement(value.display, matcher, replacement)
    if (next === value.display) return
    setYCell(doc, match.sheetId, match.row, match.col, next)
}

function applyReplacement(
    haystack: string,
    matcher: CompiledMatcher,
    replacement: string
): string {
    if (matcher.useRegex && matcher.regex != null) {
        if (matcher.wholeCell) {
            const m = haystack.match(matcher.regex)
            return m != null && m[0] === haystack ? replacement : haystack
        }
        return haystack.replace(matcher.regex, replacement)
    }
    if (matcher.wholeCell) {
        const lhs = matcher.matchCase ? haystack : haystack.toLowerCase()
        const rhs = matcher.matchCase ? matcher.needle : matcher.needle.toLowerCase()
        return lhs === rhs ? replacement : haystack
    }
    if (matcher.matchCase) {
        return haystack.split(matcher.needle).join(replacement)
    }
    // Case-insensitive plain replace: walk the string and slice. Empty
    // needle is guarded by buildMatcher (returns null on empty query).
    const lowerHay = haystack.toLowerCase()
    const lowerNeedle = matcher.needle.toLowerCase()
    let out = ''
    let i = 0
    while (i < haystack.length) {
        const found = lowerHay.indexOf(lowerNeedle, i)
        if (found < 0) {
            out += haystack.slice(i)
            break
        }
        out += haystack.slice(i, found) + replacement
        i = found + lowerNeedle.length
    }
    return out
}

function errMessage(err: unknown): string {
    if (err instanceof Error) return err.message
    return String(err)
}

interface FindInputs {
    isOpen: boolean
    query: string
    matchCase: boolean
    wholeCell: boolean
    useRegex: boolean
    searchInFormulas: boolean
    scope: 'sheet' | 'workbook'
}

// JSON.stringify gives us a unique-per-tuple key without worrying
// about user-query characters colliding with delimiter bytes. The
// inputs object is tiny so the cost is negligible per store update.
function findInputsKey(s: FindInputs): string {
    return JSON.stringify([
        s.isOpen,
        s.query,
        s.matchCase,
        s.wholeCell,
        s.useRegex,
        s.searchInFormulas,
        s.scope,
    ])
}
