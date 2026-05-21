import { eq } from '@tanstack/db'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useCommentsDrawerStore } from '@tinycld/core/lib/stores/comments-drawer-store'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { CopyToFolderDialog } from '@tinycld/drive/components/CopyToFolderDialog'
import { router, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useRef } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import type * as Y from 'yjs'
import { Grid } from '../components/Grid'
import { CommentsProvider } from '../components/grid/CommentsContext'
import { SheetTabs } from '../components/SheetTabs'
import { useCellComments } from '../hooks/use-cell-comments'
import { useFormulaBridge } from '../hooks/use-formula-bridge'
import { useRealtime } from '../hooks/use-realtime'
import { useUndoManager } from '../hooks/use-undo-manager'
import { useWorkbook, WorkbookProvider } from '../hooks/use-workbook-context'
import { useWorkbookFileActions } from '../hooks/use-workbook-file-actions'
import { addSheet, useAllYSheets, useYSheets } from '../hooks/use-y-sheets'
import { applyCsvToDoc } from '../lib/csv/apply-paste'
import { useCsvImportStore } from '../lib/csv/import-store'

export default function CalcDetail() {
    const { id, sheet: sheetParam } = useLocalSearchParams<{ id: string; sheet?: string }>()
    const [driveItems] = useStore('drive_items')

    const { data: items = [], isLoading: isItemLoading } = useOrgLiveQuery(
        (query, { orgId }) =>
            query
                .from({ item: driveItems })
                .where(({ item }) => eq(item.org, orgId))
                .where(({ item }) => eq(item.id, id ?? '')),
        [id]
    )

    const item = items[0]

    // Open the realtime room as soon as we have a workbook id. The
    // server populates the doc from the source .xlsx before the first
    // SyncReply arrives, so the client never needs the file source.
    const room = useRealtime({ workbookId: item?.id ?? '' })

    if (isItemLoading || !item) {
        return <CenteredMessage label="Loading spreadsheet…" spinner />
    }

    if (room == null || !room.isReady) {
        return <CenteredMessage label="Opening…" spinner />
    }

    return (
        <WorkbookProvider
            doc={room.doc}
            awareness={room.awareness}
            isReady={room.isReady}
            isConnected={room.isConnected}
        >
            <DetailContent itemName={item.name} workbookId={item.id} sheetParam={sheetParam} />
        </WorkbookProvider>
    )
}

interface DetailContentProps {
    itemName: string
    workbookId: string
    sheetParam: string | undefined
}

function DetailContent({ itemName, workbookId, sheetParam }: DetailContentProps) {
    const { doc, isConnected } = useWorkbook()
    const undoState = useUndoManager(doc)
    useFormulaBridge(doc)
    const sheets = useYSheets(doc)
    const allSheets = useAllYSheets(doc)
    const comments = useCellComments(workbookId)
    const fileActions = useWorkbookFileActions(workbookId)
    const orgHref = useOrgHref()
    usePendingCsvImport(doc, workbookId, sheets.length > 0)

    // Resolve the active sheet from the URL query, falling back to the
    // first visible sheet when the param is missing, stale (peer-
    // renamed, deleted), or now hidden. If every sheet is hidden,
    // surface the first one regardless — the workbook is degenerate
    // but still navigable.
    const activeSheet =
        sheets.find(s => s.id === sheetParam) ?? sheets[0] ?? allSheets[0] ?? null

    const onSelect = useCallback(
        (nextSheetId: string) => {
            // setParams updates the `sheet` query param without
            // unmounting the screen. router.replace re-mounts the
            // route on web for query-only changes, which tears down
            // the Y.Doc + realtime WebSocket and races local writes
            // (newly-created pivots in particular) against the new
            // doc's SyncReply. setParams keeps the same component
            // instance + the same room, so unsaved local state
            // survives the activation.
            router.setParams({ sheet: nextSheetId })
        },
        []
    )

    const openCommentsDrawer = useCommentsDrawerStore(s => s.open)
    const resetCommentsDrawer = useCommentsDrawerStore(s => s.reset)
    const onShowComments = useCallback(
        () => openCommentsDrawer({ packageSlug: 'calc', driveItemId: workbookId }),
        [openCommentsDrawer, workbookId]
    )
    // The drawer is a singleton store; clear it when the workbook id
    // changes so threads from a prior doc can't flash for the new one.
    useEffect(() => {
        return () => resetCommentsDrawer()
    }, [resetCommentsDrawer, workbookId])

    if (activeSheet == null) {
        return <CenteredMessage label="Spreadsheet is empty." />
    }

    return (
        <CommentsProvider value={comments}>
            <View className="flex-1 bg-background">
                <View className="px-4 py-2 border-b border-border flex-row items-center gap-3">
                    <Text
                        className="text-base font-semibold text-foreground"
                        numberOfLines={1}
                        {...(typeof document !== 'undefined'
                            ? { 'data-test-id': 'calc-workbook-header' }
                            : {})}
                    >
                        {itemName}
                    </Text>
                    <ConnectionStatus isConnected={isConnected} />
                </View>
                <Grid
                    sheetId={activeSheet.id}
                    driveItemId={workbookId}
                    undoState={undoState}
                    workbookName={itemName}
                    fileActions={fileActions}
                    onActivateSheet={onSelect}
                    onShowComments={onShowComments}
                />
                <SheetTabs
                    doc={doc}
                    allSheets={allSheets}
                    activeSheetId={activeSheet.id}
                    onSelect={onSelect}
                />
                <CopyToFolderDialog
                    itemId={workbookId}
                    onCopied={newItemId =>
                        router.replace(orgHref('calc/[id]', { id: newItemId }))
                    }
                />
            </View>
        </CommentsProvider>
    )
}

interface CenteredMessageProps {
    label: string
    spinner?: boolean
}

function CenteredMessage({ label, spinner }: CenteredMessageProps) {
    return (
        <View className="flex-1 items-center justify-center gap-3 bg-background">
            {spinner ? <ActivityIndicator /> : null}
            <Text className="text-sm text-muted-foreground">{label}</Text>
        </View>
    )
}

function ConnectionStatus({ isConnected }: { isConnected: boolean }) {
    if (isConnected) return null
    return (
        <View className="flex-row items-center gap-1">
            <ActivityIndicator size="small" />
            <Text className="text-xs text-muted-foreground">Reconnecting…</Text>
        </View>
    )
}

// Drains the pending CSV import (if any) for this workbook once the doc
// has at least one sheet — that's the signal that the realtime room
// finished its initial bootstrap (xlsx → Y.Doc on the server). The
// import lands on a freshly-added sheet so the existing blank Sheet1
// stays untouched and the user sees their data in a separate tab.
//
// The ref guard prevents double-application: useEffect re-runs after
// addSheet/applyCsvToDoc bump the sheets array (and hence the
// hasSheets dep), but the store has already been drained by `take()`.
function usePendingCsvImport(doc: Y.Doc, workbookId: string, hasSheets: boolean): void {
    const take = useCsvImportStore(s => s.take)
    const handled = useRef(false)
    useEffect(() => {
        if (!hasSheets || handled.current) return
        const pending = take(workbookId)
        if (pending == null) return
        handled.current = true
        const sheetId = addSheet(doc, { name: 'Imported' })
        applyCsvToDoc(doc, sheetId, 1, 1, pending.rows)
    }, [doc, workbookId, hasSheets, take])
}
