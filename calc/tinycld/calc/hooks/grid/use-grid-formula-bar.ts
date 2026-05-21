import { useCallback } from 'react'
import { computeFormulaBarValue } from '../../components/grid/style-helpers'
import { columnLabel } from '../../lib/workbook-types'
import { useGridStore, useGridStoreApi } from '../use-grid-store'
import type { useYCell } from '../use-y-cell'

interface UseGridFormulaBarArgs {
    selectedRow: number | null
    selectedCol: number | null
    hasSelection: boolean
    readOnly: boolean
    selectedCellValue: ReturnType<typeof useYCell>
}

export interface GridFormulaBarBindings {
    cellLabel: string | null
    value: string
    selection: { start: number; end: number } | undefined
    onChange: (next: string) => void
    onSelectionChange: (start: number, end: number) => void
    onCommit: () => void
    onCancel: () => void
    onFocus: () => void
    onAnchorLayout: (rect: { left: number; top: number; width: number; height: number }) => void
}

// Bundles every prop the FormulaBar component needs into one struct.
// Keeps Grid's body free of the six per-event useCallbacks that
// otherwise bloat the orchestrating component.
export function useGridFormulaBar({
    selectedRow,
    selectedCol,
    hasSelection,
    readOnly,
    selectedCellValue,
}: UseGridFormulaBarArgs): GridFormulaBarBindings {
    const store = useGridStoreApi()
    const editSession = useGridStore(s => s.editSession)
    const selection = useGridStore(s =>
        s.editSession != null ? (s.pendingSelection ?? undefined) : undefined
    )

    const value = computeFormulaBarValue(editSession, selectedCellValue, hasSelection)
    const cellLabel =
        selectedRow != null && selectedCol != null
            ? `${columnLabel(selectedCol)}${selectedRow}`
            : null

    const onChange = useCallback(
        (next: string) => {
            if (selectedRow == null || selectedCol == null || readOnly) return
            store.getState().setEditDraft(selectedRow, selectedCol, next)
        },
        [store, selectedRow, selectedCol, readOnly]
    )

    const onCommit = useCallback(() => {
        const session = store.getState().editSession
        if (session == null) return
        store.getState().commitEdit(session.row, session.col, session.draft)
    }, [store])

    const onCancel = useCallback(() => {
        store.getState().cancelEdit()
    }, [store])

    const onFocus = useCallback(() => {
        store.getState().setActiveSurface('bar')
    }, [store])

    const onSelectionChange = useCallback(
        (start: number, end: number) => {
            const session = store.getState().editSession
            if (session == null) return
            store.getState().setEditSelection(session.row, session.col, start, end)
        },
        [store]
    )

    const onAnchorLayout = useCallback(
        (rect: { left: number; top: number; width: number; height: number }) => {
            store.getState().setFormulaBarRect(rect)
        },
        [store]
    )

    return {
        cellLabel,
        value,
        selection,
        onChange,
        onSelectionChange,
        onCommit,
        onCancel,
        onFocus,
        onAnchorLayout,
    }
}
