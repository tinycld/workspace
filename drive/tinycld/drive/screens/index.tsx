import { FlashList, type FlashListRef, useRecyclingState } from '@shopify/flash-list'
import { DataTableHeader } from '@tinycld/core/components/DataTableHeader'
import { EmptyState } from '@tinycld/core/components/EmptyState'
import { rowFocusStyle } from '@tinycld/core/components/focusable-row'
import { HoverAction } from '@tinycld/core/components/HoverAction'
import { LoadingState } from '@tinycld/core/components/LoadingState'
import { RowHoverActions } from '@tinycld/core/components/RowHoverActions'
import { StarIcon } from '@tinycld/core/components/StarIcon'
import { ConfirmTrash } from '@tinycld/core/components/SuretyGuard'
import { SwipeableRow, SwipeableRowProvider } from '@tinycld/core/components/SwipeableRow'
import { useBreakpoint } from '@tinycld/core/components/workspace/useBreakpoint'
import { useAuthedThumbnailURL } from '@tinycld/core/file-viewer/use-authed-file-url'
import { formatBytes, formatDate } from '@tinycld/core/lib/format-utils'
import { queryClient } from '@tinycld/core/lib/pocketbase'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Download, Info, Star, Trash2 } from 'lucide-react-native'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    type GestureResponderEvent,
    Image,
    LayoutAnimation,
    type LayoutChangeEvent,
    Platform,
    Pressable,
    RefreshControl,
    Text,
    View,
} from 'react-native'
import { DriveContextMenu } from '../components/DriveContextMenu'
import { getFileIcon } from '../components/file-icons'
import { Thumbnail } from '../components/Thumbnail'
import { UploadingGridCard } from '../components/UploadingGridCard'
import { UploadingListRow } from '../components/UploadingListRow'
import { useDoubleClick } from '../hooks/useDoubleClick'
import { type DriveActions, useDrive, useRegisterDriveLayoutAnimation } from '../hooks/useDrive'
import { type GridRow, type ListRow, useGridRows, useListRows } from '../hooks/useDriveRows'
import { useDriveShortcuts } from '../hooks/useDriveShortcuts'
import { useFileSelection } from '../hooks/useFileSelection'
import { useUploadPlaceholders } from '../hooks/useUploadPlaceholders'
import { driveItemToSource } from '../lib/file-url'
import { useDriveUIStore } from '../stores/drive-ui-store'
import type { DriveItemView } from '../types'

const DRIVE_COLUMNS = [
    { label: 'Name', flex: 3 },
    { label: 'Owner', flex: 2 },
    { label: 'Date modified', flex: 2 },
    { label: 'File size', flex: 1 },
    { label: '', width: 108 },
]

const TRASH_COLUMNS = [
    { label: 'Name', flex: 3 },
    { label: 'Date deleted', flex: 2 },
    { label: 'File size', flex: 1 },
]

const GRID_GAP = 12
const GRID_PADDING = 16
const CARD_MIN_DESKTOP = 200
const CARD_MIN_MOBILE = 150
// Grid cards (file + folder + uploading) all share this body height so
// rows in the grid layout don't have to stretch one cell to match a
// taller neighbour. 120 thumbnail area + ~36 chrome + 12 padding gap.
const GRID_CARD_HEIGHT = 168

interface GridLayoutInfo {
    cols: number
    onLayout: (e: LayoutChangeEvent) => void
}

function useGridColumns(isMobile: boolean): GridLayoutInfo {
    const cardMin = isMobile ? CARD_MIN_MOBILE : CARD_MIN_DESKTOP
    const [width, setWidth] = useState(0)
    const onLayout = useCallback((e: LayoutChangeEvent) => {
        setWidth((prev) => {
            const next = e.nativeEvent.layout.width
            return prev === next ? prev : next
        })
    }, [])
    const cols = useMemo(() => {
        if (width <= 0) return 2
        const inner = width - GRID_PADDING * 2
        return Math.max(2, Math.floor((inner + GRID_GAP) / (cardMin + GRID_GAP)))
    }, [width, cardMin])
    return { cols, onLayout }
}

interface CellContext {
    isMobile: boolean
    isTrash: boolean
    mutedColor: string
    borderColor: string
    activeIndicator: string
    dangerColor: string
    infoColor: string
    warningColor: string
    focusedId: string | null
    isSelected: (id: string) => boolean
    handleSelect: (id: string, event: GestureResponderEvent) => void
    actions: DriveActions
}

export default function DriveScreen() {
    const drive = useDrive()
    const {
        viewMode,
        activeSection,
        currentFolderId,
        currentItems,
        searchQuery,
        isSearching,
        isLoading,
        openPrompt,
        actions,
        itemsById,
        userOrgId,
    } = drive
    const isSearchActive = searchQuery.length >= 2
    const isTrash = activeSection === 'trash'
    const isMobile = useBreakpoint() === 'mobile'

    // Subscribe to upload progress here (not via DriveContextValue) so the
    // toolbar/dialogs/sidebar/preview don't re-render on every progress tick.
    const uploadPlaceholders = useUploadPlaceholders({
        userOrgId,
        activeSection,
        currentFolderId,
        isSearchActive,
        itemsById,
    })

    // Theme colors are global — read once at the screen level so all rows
    // share the same JS-side cache. useThemeColor hits getComputedStyle on
    // the document element; doing that 3-4× per row × 50 rows would re-pay
    // the cost on every toggle.
    const mutedColor = useThemeColor('muted-foreground')
    const borderColor = useThemeColor('border')
    const activeIndicator = useThemeColor('active-indicator')
    const dangerColor = useThemeColor('danger')
    const infoColor = useThemeColor('info')
    const warningColor = useThemeColor('warning')

    const [isRefreshing, setIsRefreshing] = useState(false)
    const handleRefresh = useCallback(async () => {
        setIsRefreshing(true)
        try {
            await queryClient.invalidateQueries()
        } finally {
            setIsRefreshing(false)
        }
    }, [])

    // Upload placeholders are appended to the file list; merging happens here
    // (rather than in useDriveItems) so progress ticks only re-render the
    // screen, not every useDrive() consumer.
    const { folders, files } = useMemo(
        () => ({
            folders: currentItems.filter((i) => i.isFolder),
            files: [...currentItems.filter((i) => !i.isFolder), ...uploadPlaceholders],
        }),
        [currentItems, uploadPlaceholders]
    )

    const { cols, onLayout } = useGridColumns(isMobile)
    const listRows = useListRows({ folders, files })
    const gridRows = useGridRows({ folders, files })

    // Navigable items power keyboard nav and shift-range selection. Skips
    // upload placeholders since they aren't actionable.
    const navigableItems = useMemo(() => [...folders, ...files.filter((i) => !i.uploadStatus)], [folders, files])
    const orderedIds = useMemo(() => navigableItems.map((i) => i.id), [navigableItems])
    const { handleSelect, isSelected } = useFileSelection(orderedIds)
    const selectToggle = useDriveUIStore((s) => s.selectToggle)
    const { focusedId } = useDriveShortcuts({
        items: navigableItems,
        toggleSelect: selectToggle,
        openItem: (item) => {
            if (item.isFolder) actions.navigateToFolder(item.id)
            else actions.openPreview(item)
        },
        onNewFolder: () => openPrompt({ type: 'new-folder' }),
        isEnabled: !isTrash,
        listKey: `${activeSection}:${currentFolderId}`,
    })

    const listFlashRef = useRef<FlashListRef<ListRow>>(null)
    const gridFlashRef = useRef<FlashListRef<GridRow>>(null)

    // Read rows through refs so the scroll-to-focused effect doesn't re-fire
    // when row arrays churn identity unrelated to focus. Only focusedId
    // changes should drive a programmatic scroll.
    const listRowsRef = useRef(listRows)
    const gridRowsRef = useRef(gridRows)
    listRowsRef.current = listRows
    gridRowsRef.current = gridRows

    useEffect(() => {
        if (!focusedId) return
        if (viewMode === 'list') {
            const idx = listRowsRef.current.findIndex((r) => r.item.id === focusedId)
            if (idx < 0) return
            listFlashRef.current?.scrollToIndex({ index: idx, viewPosition: 0.5, animated: true })
        } else {
            const idx = gridRowsRef.current.findIndex((r) => r.kind === 'card' && r.item.id === focusedId)
            if (idx < 0) return
            gridFlashRef.current?.scrollToIndex({ index: idx, viewPosition: 0.5, animated: true })
        }
    }, [focusedId, viewMode])

    // LayoutAnimation is experimental on Android per FlashList's docs, so
    // we skip the prep there. The active list (whichever ref is mounted)
    // gets prepareForLayoutAnimationRender called before each reorder
    // mutation; only one ref will resolve to a mounted FlashList at a
    // time, so it's safe to fire both.
    const prepareLayoutAnimation = useCallback(() => {
        if (Platform.OS === 'android') return
        listFlashRef.current?.prepareForLayoutAnimationRender()
        gridFlashRef.current?.prepareForLayoutAnimationRender()
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    }, [])
    useRegisterDriveLayoutAnimation(prepareLayoutAnimation)

    const cellContext: CellContext = useMemo(
        () => ({
            isMobile,
            isTrash,
            mutedColor,
            borderColor,
            activeIndicator,
            dangerColor,
            infoColor,
            warningColor,
            focusedId,
            isSelected,
            handleSelect,
            actions,
        }),
        [
            isMobile,
            isTrash,
            mutedColor,
            borderColor,
            activeIndicator,
            dangerColor,
            infoColor,
            warningColor,
            focusedId,
            isSelected,
            handleSelect,
            actions,
        ]
    )

    if (isSearching) {
        return <LoadingState message="Searching…" />
    }

    const hasAnything = currentItems.length > 0 || uploadPlaceholders.length > 0
    if (isLoading && !hasAnything) {
        return <LoadingState />
    }

    if (!hasAnything) {
        let message = 'No files in this location'
        if (isSearchActive) message = `No results for "${searchQuery}"`
        else if (isTrash) message = 'Trash is empty'
        return <EmptyState message={message} />
    }

    return (
        <SwipeableRowProvider>
            <View className="flex-1" onLayout={onLayout}>
                {viewMode === 'list' ? (
                    <DriveListMode
                        rows={listRows}
                        flashRef={listFlashRef}
                        cellContext={cellContext}
                        columns={isTrash ? TRASH_COLUMNS : DRIVE_COLUMNS}
                        showColumnHeader={!isMobile}
                        isMobile={isMobile}
                        isRefreshing={isRefreshing}
                        onRefresh={handleRefresh}
                    />
                ) : (
                    <DriveGridMode
                        rows={gridRows}
                        cols={cols}
                        flashRef={gridFlashRef}
                        cellContext={cellContext}
                        isMobile={isMobile}
                        isRefreshing={isRefreshing}
                        onRefresh={handleRefresh}
                    />
                )}
            </View>
        </SwipeableRowProvider>
    )
}

interface ListModeProps {
    rows: ListRow[]
    flashRef: React.RefObject<FlashListRef<ListRow> | null>
    cellContext: CellContext
    columns: typeof DRIVE_COLUMNS
    showColumnHeader: boolean
    isMobile: boolean
    isRefreshing: boolean
    onRefresh: () => void
}

function DriveListMode({
    rows,
    flashRef,
    cellContext,
    columns,
    showColumnHeader,
    isMobile,
    isRefreshing,
    onRefresh,
}: ListModeProps) {
    const renderItem = useCallback(
        ({ item, extraData }: { item: ListRow; extraData?: CellContext }) => {
            const ctx = extraData ?? cellContext
            const it = item.item
            if (it.uploadStatus) {
                return <UploadingListRow item={it} onDismiss={ctx.actions.dismissUpload} />
            }
            if (ctx.isTrash) {
                return (
                    <DriveContextMenu item={it}>
                        <TrashListRow item={it} ctx={ctx} />
                    </DriveContextMenu>
                )
            }
            return (
                <DriveContextMenu item={it}>
                    <FilesListRow item={it} index={item.index} ctx={ctx} />
                </DriveContextMenu>
            )
        },
        [cellContext]
    )

    const keyExtractor = useCallback((row: ListRow) => row.item.id, [])
    const getItemType = useCallback((row: ListRow) => (row.item.uploadStatus ? 'upload' : 'file'), [])

    const ListHeader = useMemo(
        () => (showColumnHeader ? <DataTableHeader columns={columns} /> : null),
        [showColumnHeader, columns]
    )

    return (
        <FlashList<ListRow>
            ref={flashRef}
            data={rows}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            getItemType={getItemType}
            extraData={cellContext}
            contentContainerStyle={{ paddingHorizontal: isMobile ? 0 : 16 }}
            ListHeaderComponent={ListHeader}
            refreshControl={isMobile ? <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} /> : undefined}
        />
    )
}

interface GridModeProps {
    rows: GridRow[]
    cols: number
    flashRef: React.RefObject<FlashListRef<GridRow> | null>
    cellContext: CellContext
    isMobile: boolean
    isRefreshing: boolean
    onRefresh: () => void
}

function DriveGridMode({ rows, cols, flashRef, cellContext, isMobile, isRefreshing, onRefresh }: GridModeProps) {
    const renderItem = useCallback(
        ({ item, extraData }: { item: GridRow; extraData?: CellContext }) => {
            const ctx = extraData ?? cellContext
            if (item.kind === 'section') {
                return <GridSectionHeader title={item.title} />
            }
            const it = item.item
            return (
                <View style={{ paddingHorizontal: GRID_GAP / 2, paddingBottom: GRID_GAP }}>
                    {it.uploadStatus ? (
                        <UploadingGridCard item={it} onDismiss={ctx.actions.dismissUpload} />
                    ) : (
                        <DriveContextMenu item={it}>
                            {it.isFolder ? (
                                <FolderGridCard item={it} ctx={ctx} />
                            ) : (
                                <FileGridCard item={it} ctx={ctx} />
                            )}
                        </DriveContextMenu>
                    )}
                </View>
            )
        },
        [cellContext]
    )

    const keyExtractor = useCallback((row: GridRow, index: number) => {
        if (row.kind === 'section') return `__section_${row.title}__`
        return row.item.id
    }, [])

    const getItemType = useCallback((row: GridRow) => {
        if (row.kind === 'section') return 'section'
        const it = row.item
        if (it.uploadStatus) return 'upload'
        if (it.isFolder) return 'folder'
        return 'file'
    }, [])

    const overrideItemLayout = useCallback(
        (layout: { span?: number }, row: GridRow) => {
            if (row.kind === 'section') {
                layout.span = cols
            }
        },
        [cols]
    )

    return (
        <FlashList<GridRow>
            ref={flashRef}
            data={rows}
            numColumns={cols}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            getItemType={getItemType}
            overrideItemLayout={overrideItemLayout}
            extraData={cellContext}
            contentContainerStyle={{ paddingHorizontal: GRID_PADDING - GRID_GAP / 2 }}
            refreshControl={isMobile ? <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} /> : undefined}
        />
    )
}

const FilesListRow = memo(FilesListRowImpl)
function FilesListRowImpl({ item, index, ctx }: { item: DriveItemView; index: number; ctx: CellContext }) {
    const { actions } = ctx
    const handleInfo = useCallback(() => {
        actions.selectItem(item.id)
        actions.openDetailPanel()
    }, [item.id, actions])
    // Hover state must reset when the cell recycles to a different item,
    // otherwise the wrong row briefly renders hovered for one frame after
    // a fast scroll.
    const [isHovered, setIsHovered] = useRecyclingState(false, [item.id])

    const handleSingle = useCallback((event: GestureResponderEvent) => ctx.handleSelect(item.id, event), [item.id, ctx])
    const handleDouble = useCallback(() => {
        if (item.isFolder) actions.navigateToFolder(item.id)
        else actions.openPreview(item)
    }, [item, actions])
    const handleFileDoublePress = useDoubleClick(handleSingle, handleDouble)
    // Folders open on a single click on web — selection only happens with
    // a modifier (cmd/ctrl/shift) so users can still build a multi-select
    // for bulk actions. Modifier paths fall through to handleSelect.
    const handleFolderWebPress = useCallback(
        (event: GestureResponderEvent) => {
            const native = event.nativeEvent as unknown as MouseEvent
            if (native.metaKey || native.ctrlKey || native.shiftKey) {
                ctx.handleSelect(item.id, event)
                return
            }
            actions.navigateToFolder(item.id)
        },
        [item.id, ctx, actions]
    )
    const handlePress = item.isFolder ? handleFolderWebPress : handleFileDoublePress

    const handleMobilePress = useCallback(() => {
        if (item.isFolder) actions.navigateToFolder(item.id)
        else actions.openPreview(item)
    }, [item, actions])

    const swipeActions = useMemo(
        () => [
            {
                icon: Trash2,
                label: 'Delete',
                onPress: () => actions.moveToTrash(item.id),
                backgroundColor: ctx.dangerColor,
            },
            {
                icon: Download,
                label: 'Download',
                onPress: () => actions.downloadItem(item.id),
                backgroundColor: ctx.infoColor,
            },
            {
                icon: Star,
                label: item.starred ? 'Unstar' : 'Star',
                onPress: () => actions.toggleStar(item.id),
                backgroundColor: ctx.warningColor,
            },
        ],
        [item.id, item.starred, actions, ctx.dangerColor, ctx.infoColor, ctx.warningColor]
    )

    if (ctx.isMobile) {
        const mobileRow = (
            <Pressable
                onPress={handleMobilePress}
                className="flex-row items-center px-4 py-3 border-b border-border gap-3"
            >
                <ListRowThumbnail item={item} size={40} fallbackIconSize={24} mutedColor={ctx.mutedColor} />
                <View className="flex-1 gap-0.5">
                    <Text numberOfLines={1} className="text-foreground" style={{ fontSize: 16, fontWeight: '500' }}>
                        {item.name}
                    </Text>
                    <Text numberOfLines={1} className="text-muted-foreground" style={{ fontSize: 12 }}>
                        {formatDate(item.updated)}
                        {item.isFolder ? '' : ` · ${formatBytes(item.size)}`}
                    </Text>
                </View>
                <Pressable
                    className="p-1"
                    onPress={(e) => {
                        e.stopPropagation()
                        actions.toggleStar(item.id)
                    }}
                >
                    <StarIcon isStarred={item.starred} size={18} />
                </Pressable>
            </Pressable>
        )

        return <SwipeableRow actions={swipeActions}>{mobileRow}</SwipeableRow>
    }

    const isFocused = item.id === ctx.focusedId
    const isSelectedRow = ctx.isSelected(item.id)
    const effectStyle = rowFocusStyle({
        isFocused,
        isHovered,
        borderColor: ctx.borderColor,
        activeIndicator: ctx.activeIndicator,
    })
    const tooltipPosition = index === 0 ? ('below' as const) : ('above' as const)

    const hoverWebProps =
        Platform.OS === 'web'
            ? {
                  onMouseEnter: () => setIsHovered(true),
                  onMouseLeave: () => setIsHovered(false),
              }
            : {}

    return (
        <Pressable
            onPress={handlePress}
            accessibilityRole="button"
            accessibilityLabel={`${item.name} ${item.owner} ${formatDate(item.updated)}`}
            className={`flex-row items-center px-3 py-2.5 border-b border-border ${isSelectedRow ? '' : 'bg-background'}`}
            style={[isSelectedRow ? { backgroundColor: `${ctx.activeIndicator}12` } : null, effectStyle]}
            {...hoverWebProps}
        >
            <View className="flex-row items-center" style={{ gap: 10, flex: 3 }}>
                <ListRowThumbnail item={item} size={28} fallbackIconSize={20} mutedColor={ctx.mutedColor} />
                <Text
                    numberOfLines={1}
                    className="flex-1 text-foreground"
                    style={{
                        fontSize: 13,
                        fontWeight: '500',
                    }}
                >
                    {item.name}
                </Text>
            </View>
            <Text numberOfLines={1} className="text-muted-foreground" style={{ fontSize: 12, flex: 2 }}>
                {item.owner}
            </Text>
            <Text className="text-muted-foreground" style={{ fontSize: 12, flex: 2 }}>
                {formatDate(item.updated)}
            </Text>
            <Text className="text-muted-foreground" style={{ fontSize: 12, flex: 1 }}>
                {item.isFolder ? '—' : formatBytes(item.size)}
            </Text>
            <RowHoverActions
                isHovered={isHovered}
                width={108}
                rest={
                    <Pressable
                        style={{ padding: 4 }}
                        onPress={(e) => {
                            e.stopPropagation()
                            actions.toggleStar(item.id)
                        }}
                    >
                        <StarIcon isStarred={item.starred} size={16} />
                    </Pressable>
                }
                hover={
                    <>
                        <HoverAction icon={Info} label="Info" onPress={handleInfo} tooltipPosition={tooltipPosition} />
                        <ConfirmTrash itemName={item.name} onConfirmed={() => actions.moveToTrash(item.id)}>
                            {(onOpen) => (
                                <HoverAction
                                    icon={Trash2}
                                    label="Delete"
                                    onPress={onOpen}
                                    tooltipPosition={tooltipPosition}
                                />
                            )}
                        </ConfirmTrash>
                        <HoverAction
                            icon={Download}
                            label="Download"
                            onPress={() => actions.downloadItem(item.id)}
                            tooltipPosition={tooltipPosition}
                        />
                        <HoverAction
                            icon={Star}
                            label={item.starred ? 'Unstar' : 'Star'}
                            onPress={() => actions.toggleStar(item.id)}
                            iconColor={item.starred ? ctx.mutedColor : ctx.warningColor}
                            iconFill={item.starred ? 'transparent' : ctx.warningColor}
                            tooltipPosition={tooltipPosition}
                        />
                    </>
                }
            />
        </Pressable>
    )
}

const ListRowThumbnail = memo(ListRowThumbnailImpl)
function ListRowThumbnailImpl({
    item,
    size,
    fallbackIconSize,
    mutedColor,
}: {
    item: DriveItemView
    size: number
    fallbackIconSize: number
    mutedColor: string
}) {
    const { icon: FileIcon, color: iconColor } = getFileIcon(item.category, mutedColor)
    const { url: thumbnailUrl } = useAuthedThumbnailURL(
        item.isFolder ? undefined : driveItemToSource(item),
        `${size * 2}x${size * 2}`
    )

    if (!thumbnailUrl) {
        return (
            <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
                <FileIcon size={fallbackIconSize} color={iconColor} />
            </View>
        )
    }

    return (
        <Image
            source={{ uri: thumbnailUrl }}
            style={{ width: size, height: size, borderRadius: 4 }}
            resizeMode="cover"
        />
    )
}

const TrashListRow = memo(TrashListRowImpl)
function TrashListRowImpl({ item, ctx }: { item: DriveItemView; ctx: CellContext }) {
    const isSelectedRow = ctx.isSelected(item.id)

    if (ctx.isMobile) {
        return (
            <Pressable
                onPress={(e) => ctx.handleSelect(item.id, e)}
                className="flex-row items-center px-4 py-3 border-b border-border gap-3"
            >
                <ListRowThumbnail item={item} size={40} fallbackIconSize={24} mutedColor={ctx.mutedColor} />
                <View className="flex-1 gap-0.5">
                    <Text numberOfLines={1} className="text-foreground" style={{ fontSize: 16, fontWeight: '500' }}>
                        {item.name}
                    </Text>
                    <Text numberOfLines={1} className="text-muted-foreground" style={{ fontSize: 12 }}>
                        Deleted {formatDate(item.trashedAt)}
                        {item.isFolder ? '' : ` · ${formatBytes(item.size)}`}
                    </Text>
                </View>
            </Pressable>
        )
    }

    return (
        <Pressable
            onPress={(e) => ctx.handleSelect(item.id, e)}
            className="flex-row items-center px-3 py-2.5 border-b border-border"
            style={isSelectedRow ? { backgroundColor: `${ctx.activeIndicator}12` } : undefined}
        >
            <View className="flex-row items-center" style={{ gap: 10, flex: 3 }}>
                <ListRowThumbnail item={item} size={28} fallbackIconSize={20} mutedColor={ctx.mutedColor} />
                <Text
                    numberOfLines={1}
                    className="flex-1 text-foreground"
                    style={{
                        fontSize: 13,
                        fontWeight: '500',
                    }}
                >
                    {item.name}
                </Text>
            </View>
            <Text className="text-muted-foreground" style={{ fontSize: 12, flex: 2 }}>
                {formatDate(item.trashedAt)}
            </Text>
            <Text className="text-muted-foreground" style={{ fontSize: 12, flex: 1 }}>
                {item.isFolder ? '—' : formatBytes(item.size)}
            </Text>
        </Pressable>
    )
}

function GridSectionHeader({ title }: { title: string }) {
    return (
        <Text
            className="uppercase text-muted-foreground"
            style={{
                fontSize: 12,
                fontWeight: '600',
                letterSpacing: 0.5,
                marginTop: 8,
                marginBottom: 10,
                paddingHorizontal: GRID_GAP / 2,
            }}
        >
            {title}
        </Text>
    )
}

const FolderGridCard = memo(FolderGridCardImpl)
function FolderGridCardImpl({ item, ctx }: { item: DriveItemView; ctx: CellContext }) {
    const { actions } = ctx
    const { icon: FileIcon, color: iconColor } = getFileIcon(item.category, ctx.mutedColor)
    const isSelectedRow = ctx.isSelected(item.id)

    const handleNavigate = useCallback(() => actions.navigateToFolder(item.id), [item.id, actions])
    // Single-click navigates on both platforms. On web, modifier keys
    // (cmd/ctrl/shift) still build a multi-select for bulk operations.
    const handlePress = useCallback(
        (event: GestureResponderEvent) => {
            if (ctx.isMobile) {
                handleNavigate()
                return
            }
            const native = event.nativeEvent as unknown as MouseEvent
            if (native.metaKey || native.ctrlKey || native.shiftKey) {
                ctx.handleSelect(item.id, event)
                return
            }
            handleNavigate()
        },
        [ctx, item.id, handleNavigate]
    )

    return (
        <Pressable
            onPress={handlePress}
            accessibilityRole="button"
            accessibilityLabel={`${item.name} ${formatDate(item.updated)}`}
            style={{ height: GRID_CARD_HEIGHT }}
            className={`rounded-lg border ${isSelectedRow ? 'border-2 border-active-indicator' : 'border-border'}`}
        >
            <View className="flex-row items-center gap-2.5 px-3 py-2.5 border-b border-border">
                <FileIcon size={20} color={iconColor} />
                <Text numberOfLines={1} className="flex-1 text-xs font-medium text-foreground">
                    {item.name}
                </Text>
            </View>
            <View className="flex-1 items-center justify-center bg-muted-foreground/5">
                <FileIcon size={56} color={iconColor} />
            </View>
        </Pressable>
    )
}

const FileGridCard = memo(FileGridCardImpl)
function FileGridCardImpl({ item, ctx }: { item: DriveItemView; ctx: CellContext }) {
    const { actions } = ctx
    const { icon: FileIcon, color: iconColor } = getFileIcon(item.category, ctx.mutedColor)
    const isSelectedRow = ctx.isSelected(item.id)

    const handleSingle = useCallback((event: GestureResponderEvent) => ctx.handleSelect(item.id, event), [item.id, ctx])
    const handleDouble = useCallback(() => actions.openPreview(item), [item, actions])
    const handleDesktopPress = useDoubleClick(handleSingle, handleDouble)
    const handlePress = ctx.isMobile ? handleDouble : handleDesktopPress

    return (
        <Pressable
            onPress={handlePress}
            accessibilityRole="button"
            accessibilityLabel={`${item.name} ${formatDate(item.updated)}`}
            style={{ height: GRID_CARD_HEIGHT }}
            className={`rounded-lg overflow-hidden border ${isSelectedRow ? 'border-2 border-active-indicator' : 'border-border'}`}
        >
            <View className="flex-row items-center gap-2 px-2.5 py-2 border-b border-border">
                <FileIcon size={18} color={iconColor} />
                <Text numberOfLines={1} className="flex-1 text-xs font-medium text-foreground">
                    {item.name}
                </Text>
            </View>
            <View className="flex-1 items-center justify-center bg-muted-foreground/5">
                <Thumbnail item={item} size={120} />
            </View>
        </Pressable>
    )
}
