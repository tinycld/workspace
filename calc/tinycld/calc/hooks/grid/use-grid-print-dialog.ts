import { useMemo } from 'react'
import type { PrintSelection } from '../../components/PrintDialog'
import { isDisjoint, primaryRange } from '../../lib/selection-range'
import { usePrintDialog } from '../use-print-dialog'
import { useGridStore } from '../use-grid-store'

export interface GridPrintDialog {
    isOpen: boolean
    open: () => void
    close: () => void
    // The print dialog's "current selection" scope only makes sense
    // for a true rectangular selection — a lone anchor cell falls
    // through to null so the dialog hides the option.
    currentSelection: PrintSelection | null
}

export function useGridPrintDialog(sheetId: string): GridPrintDialog {
    const isOpen = usePrintDialog(s => s.isOpen)
    const open = usePrintDialog(s => s.open)
    const close = usePrintDialog(s => s.close)
    // Tier B: "current selection" option is meaningful only for a
    // single contiguous rectangle. On a disjoint selection
    // currentSelection is null and the dialog hides the option.
    const selection = useGridStore(s => s.selection)
    const disjoint = useGridStore(s => isDisjoint(s.selection))
    const currentSelection = useMemo<PrintSelection | null>(() => {
        if (disjoint) return null
        const range = primaryRange(selection)
        if (range == null) return null
        // Single-cell ranges fall through with no current-selection
        // option (matches the legacy behavior: only multi-cell
        // ranges produce a meaningful print rectangle).
        if (
            range.startRow === range.endRow &&
            range.startCol === range.endCol
        ) {
            return null
        }
        return {
            sheetId,
            rect: {
                startRow: range.startRow,
                startCol: range.startCol,
                endRow: range.endRow,
                endCol: range.endCol,
            },
        }
    }, [selection, disjoint, sheetId])

    return { isOpen, open, close, currentSelection }
}
