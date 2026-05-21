// Lazy-cached fetch of HyperFormula's registered function names. The
// list is static once the engine module loads (~390 functions for the
// default enGB language pack), so a single async load shared across
// every Grid mount is enough.
//
// We intentionally use a separate dynamic import here rather than
// piggybacking on FormulaBridge's instance: the bundler sees the same
// chunk URL and the second import resolves from cache, so there's no
// extra network cost. Decoupling keeps the autocomplete UI alive even
// before the bridge has finished its cold-start mirror.

let cached: string[] | null = null
let inflight: Promise<string[]> | null = null

const LANGUAGE_CODE = 'enGB'

export async function loadFormulaFunctionNames(): Promise<string[]> {
    if (cached != null) return cached
    if (inflight != null) return inflight
    inflight = (async () => {
        const { HyperFormula } = await import('hyperformula')
        const names = HyperFormula.getRegisteredFunctionNames(LANGUAGE_CODE)
        cached = [...names].sort()
        inflight = null
        return cached
    })()
    return inflight
}

// Test-only reset so unit tests can re-stub the loader cleanly.
export function _resetFormulaFunctionNamesForTests(): void {
    cached = null
    inflight = null
}
