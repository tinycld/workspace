import { captureException } from '@tinycld/core/lib/errors'
import { useEffect } from 'react'
import type * as Y from 'yjs'
import {
    createFormulaBridge,
    type FormulaBridge,
    unregisterFormulaBridge,
} from '../lib/formula/bridge'

// useFormulaBridge starts a FormulaBridge against the given Y.Doc on
// mount and tears it down on unmount or when the doc identity changes.
//
// HyperFormula loads via dynamic import inside createFormulaBridge so
// the ~250KB engine doesn't ship in any non-calc bundle. The async
// boundary is handled with a cancellation flag so a fast unmount
// doesn't leak a started bridge.
export function useFormulaBridge(doc: Y.Doc | null): void {
    useEffect(() => {
        if (doc == null) return
        let bridge: FormulaBridge | null = null
        let cancelled = false
        createFormulaBridge(doc).then(
            b => {
                if (cancelled) {
                    b.stop()
                    unregisterFormulaBridge(doc)
                    return
                }
                bridge = b
            },
            err => {
                captureException('useFormulaBridge: failed to start', err)
            }
        )
        return () => {
            cancelled = true
            bridge?.stop()
            unregisterFormulaBridge(doc)
        }
    }, [doc])
}
