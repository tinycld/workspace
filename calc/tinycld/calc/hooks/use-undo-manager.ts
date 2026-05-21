import {
    type UndoManagerState,
    useYUndoManager,
} from '@tinycld/core/lib/realtime/use-y-undo-manager'
import { useCallback } from 'react'
import type * as Y from 'yjs'
import { CELLS_MAP, SHEETS_MAP } from '../lib/y-doc-bootstrap'

// useUndoManager scopes Y.UndoManager + Cmd-Z/Cmd-Shift-Z to the
// calc-specific cells + sheets Y.Maps. Returns the same state object
// the core hook exposes — { canUndo, canRedo, undo, redo } — so the
// toolbar buttons and keyboard shortcuts share a single manager.
export function useUndoManager(doc: Y.Doc | null): UndoManagerState {
    const scope = useCallback(() => {
        if (doc == null) return []
        return [doc.getMap(CELLS_MAP), doc.getMap(SHEETS_MAP)]
    }, [doc])

    return useYUndoManager(doc, { scope })
}

export type { UndoManagerState }
