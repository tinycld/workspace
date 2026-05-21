import { captureException } from '@tinycld/core/lib/errors'
import { useEffect, useState } from 'react'
import { loadFormulaFunctionNames } from '../lib/formula/function-names'

// useFormulaFunctionNames returns HyperFormula's registered function
// list for the autocomplete dropdown. The first caller in the app pays
// the dynamic-import cost once; subsequent callers receive the cached
// array synchronously on next render.
//
// The empty initial value means the dropdown stays closed until the
// list is available — good enough since the load completes within the
// first user interaction window in practice.
export function useFormulaFunctionNames(): string[] {
    const [names, setNames] = useState<string[]>([])
    useEffect(() => {
        let cancelled = false
        loadFormulaFunctionNames().then(
            list => {
                if (!cancelled) setNames(list)
            },
            err => {
                captureException('useFormulaFunctionNames: failed to load', err)
            }
        )
        return () => {
            cancelled = true
        }
    }, [])
    return names
}
