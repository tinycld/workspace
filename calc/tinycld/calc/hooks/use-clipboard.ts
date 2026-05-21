import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import { useCallback, useMemo } from 'react'
import { Platform } from 'react-native'
import type * as Y from 'yjs'
import {
    readFromOsClipboard as readFromOsClipboardNative,
    writeToOsClipboard as writeToOsClipboardNative,
} from '../lib/clipboard/adapter-native'
import {
    type AdapterReadResult,
    readFromOsClipboard as readFromOsClipboardWeb,
    writeToOsClipboard as writeToOsClipboardWeb,
} from '../lib/clipboard/adapter-web'
import { applyPayloadToDoc } from '../lib/clipboard/deserialize'
import { serializeRange } from '../lib/clipboard/serialize'
import type { ClipboardPayload, PasteMode } from '../lib/clipboard/types'
import {
    forEachCellInRange,
    isDisjoint,
    primaryAnchor,
    primaryRange,
} from '../lib/selection-range'
import type { CellRange, GridStoreApi } from './grid-store'
import { deleteYCell } from './use-y-cell'

// Platform-routed adapter calls. Both adapters share the same return
// shape; this thin shim picks the right one and keeps the rest of the
// hook platform-agnostic.
async function platformWrite(
    payload: ClipboardPayload
): Promise<{ markerId: string; osWriteOk: boolean }> {
    if (Platform.OS === 'web') return writeToOsClipboardWeb(payload)
    return writeToOsClipboardNative(payload)
}

async function platformRead(): Promise<AdapterReadResult | null> {
    if (Platform.OS === 'web') return readFromOsClipboardWeb()
    return readFromOsClipboardNative()
}

// useClipboard returns the orchestrated copy/cut/paste actions the
// cell context menu and the keyboard shortcuts invoke.
//
// copy(): serialize the active selection range to a ClipboardPayload,
//   push to the OS clipboard (text/html + text/plain) AND stash in
//   the in-memory fidelity store. Tags the source range on the grid
//   store so the marching-ants overlay knows what to outline.
//
// cut(): same as copy, but also marks `cutPending=true` on the grid
//   store so the next paste will clear the source cells in the same
//   transaction as the destination write.
//
// paste(mode): pull from the OS clipboard, preferring the fidelity-
//   store hit when the marker is recognised. If `cutPending` is set
//   AND the OS marker matches the marker that put us in cut state,
//   we clear the source cells inside the same doc.transact as the
//   destination write so the entire cut+paste collapses to one undo
//   step.
//
// All actions are async (clipboard API is async). They never throw —
// failures (permission denied, no clipboard content) silently no-op.

export interface UseClipboardArgs {
    doc: Y.Doc | null
    sheetId: string
    store: GridStoreApi
    readOnly?: boolean
}

export interface ClipboardActions {
    copy: () => Promise<void>
    cut: () => Promise<void>
    paste: (mode?: PasteMode) => Promise<void>
}

export function useClipboard({
    doc,
    sheetId,
    store,
    readOnly = false,
}: UseClipboardArgs): ClipboardActions {
    // Shared put-on-clipboard path. Both copy and cut serialize the
    // selection, push to the OS clipboard, and mark the grid store
    // with the marker + source range. The only difference is the
    // `isCut` flag, which controls whether paste later clears the
    // source.
    const captureSelection = useCallback(
        async (isCut: boolean): Promise<void> => {
            if (doc == null) return
            const state = store.getState()
            // Plan §6.d: refuse copy/cut on a disjoint selection.
            // Sheets behaves the same way; we surface a transient
            // banner via setSelectionStatus that the Phase 6 banner
            // UI consumes.
            if (isDisjoint(state.selection)) {
                state.setSelectionStatus({ kind: 'copy-disjoint-refused' })
                return
            }
            const range = primaryRange(state.selection)
            if (range == null) return
            const payload = serializeRange(doc, sheetId, range)
            const { markerId } = await platformWrite(payload)
            state.setClipboardMarker(markerId, range, isCut)
        },
        [doc, sheetId, store]
    )

    const copy = useCallback(() => captureSelection(false), [captureSelection])
    const cut = useCallback(() => {
        if (readOnly) return Promise.resolve()
        return captureSelection(true)
    }, [captureSelection, readOnly])

    const paste = useCallback(
        async (mode: PasteMode = 'all') => {
            if (doc == null || readOnly) return
            const result = await platformRead()
            if (result == null) return
            const state = store.getState()
            // Paste targets the primary anchor (last sub-range). On a
            // disjoint selection paste still works — the primary
            // anchor is the just-Ctrl-clicked cell which is what
            // Sheets pastes into.
            const anchor = primaryAnchor(state.selection)
            if (anchor == null) return

            const cutContext = computeCutContext(state, result.markerId)
            applyClipboardPaste(doc, sheetId, result.payload, mode, anchor, cutContext)
            if (cutContext != null) {
                state.clearClipboardMarker()
            }
        },
        [doc, sheetId, store, readOnly]
    )

    // Stable identity so downstream memos (e.g. useCalcShortcuts'
    // useMemo of the shortcut array) don't re-fire on every render
    // of Grid. The inner callbacks are already stable; this just
    // wraps them in a stable object.
    return useMemo(() => ({ copy, cut, paste }), [copy, cut, paste])
}

// computeCutContext: when paste runs and the user previously hit
// cut, decide whether to honor it. Two pre-conditions:
//   - cutPending is true on the store
//   - the marker we got back from the clipboard matches the marker
//     we stamped at cut time (so cross-app clipboard contents don't
//     accidentally clear our source range)
// Returns null when no source-clear should happen.
function computeCutContext(
    state: ReturnType<GridStoreApi['getState']>,
    osMarker: string | null
): CellRange | null {
    if (!state.cutPending) return null
    if (state.copySourceRange == null) return null
    if (state.clipboardMarker == null) return null
    if (osMarker !== state.clipboardMarker) return null
    return state.copySourceRange
}

// applyClipboardPaste: writes the payload to the destination, and
// when a cut is in flight, deletes the source cells inside the same
// doc.transact so the operation is one undo step. Yjs flattens
// nested transact calls when the origin matches, so wrapping
// applyPayloadToDoc inside an outer doc.transact with LOCAL_ORIGIN
// composes cleanly with the inner doc.transact applyPayloadToDoc
// already issues.
function applyClipboardPaste(
    doc: Y.Doc,
    sheetId: string,
    payload: ClipboardPayload,
    mode: PasteMode,
    anchor: { row: number; col: number },
    cutContext: CellRange | null
): void {
    const writeDest = () =>
        applyPayloadToDoc(doc, sheetId, payload, {
            mode,
            destAnchor: { row: anchor.row, col: anchor.col },
        })

    if (cutContext == null) {
        writeDest()
        return
    }

    doc.transact(() => {
        forEachCellInRange(cutContext, (row, col) => {
            deleteYCell(doc, sheetId, row, col)
        })
        writeDest()
    }, LOCAL_ORIGIN)
}
