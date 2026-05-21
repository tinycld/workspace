import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import { useCallback, useState } from 'react'
import * as Y from 'yjs'
import { writePivot } from '../../lib/pivot/y-binding'
import { usePivotPanelStore } from '../../lib/stores/pivot-panel-store'
import { PIVOT_SHEET_KEY, SHEETS_MAP } from '../../lib/y-doc-bootstrap'
import { PivotTableIcon } from '../icons'
import { ToolbarButton } from '../toolbar/ToolbarButton'
import {
    buildInitialPivotDefinition,
    makePivotId,
    type NewPivotFormValues,
} from './new-pivot-dialog-helpers'
import { NewPivotDialog } from './NewPivotDialog'

export interface PivotInsertButtonProps {
    // Live Y.Doc. Null while the realtime room is still handshaking — the
    // button stays disabled until the doc is ready so we never write
    // into a placeholder doc.
    doc: Y.Doc | null
    defaultSourceRange: string
    defaultTargetSheetName: string
    // Switches the workbook to the freshly-created pivot output sheet.
    // The host screen routes this through `router.replace(orgHref(...))`
    // so the URL stays the source of truth for active sheet.
    onActivateSheet: (sheetId: string) => void
    disabled?: boolean
}

// Toolbar entry point for creating a new pivot table. Opens the
// NewPivotDialog to collect source range + target sheet name; on Create,
// it (1) adds a new sheet for the output, (2) writes the pivot def into
// the doc, (3) marks the new sheet as that pivot's target via the
// pivotId meta key, (4) activates the new sheet, and (5) opens the
// side panel so the user can drag fields in. Steps 1-3 run inside a
// single doc.transact so a peer never observes a half-created pivot.
export function PivotInsertButton({
    doc,
    defaultSourceRange,
    defaultTargetSheetName,
    onActivateSheet,
    disabled,
}: PivotInsertButtonProps) {
    const [visible, setVisible] = useState(false)
    const open = useCallback(() => setVisible(true), [])
    const close = useCallback(() => setVisible(false), [])

    const onCreate = useCallback(
        ({ sourceRange, targetSheetName }: NewPivotFormValues) => {
            if (doc == null) return
            // addSheet runs its own LOCAL_ORIGIN transact and returns
            // the new sheetId synchronously. We then open a SECOND
            // transact for the pivot write + meta tag — yjs nests
            // transactions cleanly (the inner becomes a no-op
            // boundary), so this is safe; the undo manager treats the
            // two writes as separate steps which is the right behavior
            // (undoing the pivot keeps the sheet, undoing again drops
            // the sheet).
            const pivotId = makePivotId()
            const def = buildInitialPivotDefinition({
                id: pivotId,
                sourceRange,
                targetSheetName,
            })
            // Single LOCAL_ORIGIN transact for the whole create:
            // (1) build the new sheet's meta with pivotId already set,
            // (2) install it into SHEETS_MAP, (3) writePivot.
            // Doing this in one transact means one yjs update on the
            // wire; the pivotId meta key + the pivot entry always
            // arrive together, which simplifies recovery on the
            // receiver side and keeps the undo step a single unit.
            const sheetsMap = doc.getMap<Y.Map<unknown>>(SHEETS_MAP)
            let nextIndex = sheetsMap.size + 1
            while (sheetsMap.has(`sheet${nextIndex}`)) nextIndex++
            const newSheetId = `sheet${nextIndex}`
            doc.transact(() => {
                const meta = new Y.Map<unknown>()
                meta.set('name', targetSheetName)
                meta.set('position', sheetsMap.size)
                meta.set('rowCount', 0)
                meta.set('colCount', 0)
                meta.set(PIVOT_SHEET_KEY, pivotId)
                sheetsMap.set(newSheetId, meta)
                writePivot(doc, def)
            }, LOCAL_ORIGIN)
            setVisible(false)
            onActivateSheet(newSheetId)
            usePivotPanelStore.getState().open(newSheetId)
        },
        [doc, onActivateSheet]
    )

    return (
        <>
            <ToolbarButton
                icon={PivotTableIcon}
                label="Insert pivot table"
                disabled={disabled || doc == null}
                onPress={open}
            />
            <NewPivotDialog
                visible={visible}
                defaultSourceRange={defaultSourceRange}
                defaultTargetSheetName={defaultTargetSheetName}
                onCancel={close}
                onCreate={onCreate}
            />
        </>
    )
}
