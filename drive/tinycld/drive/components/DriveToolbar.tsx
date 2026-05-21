import { HelpIcon } from '@tinycld/core/components/help/HelpIcon'
import { ResponsiveToolbar, type ToolbarItem } from '@tinycld/core/components/ResponsiveToolbar'
import { ScreenHeader } from '@tinycld/core/components/ScreenHeader'
import { ConfirmTrash, SuretyGuard } from '@tinycld/core/components/SuretyGuard'
import { ToolbarIconButton } from '@tinycld/core/components/ToolbarIconButton'
import { ToolbarSeparator } from '@tinycld/core/components/ToolbarSeparator'
import { useBreakpoint } from '@tinycld/core/components/workspace/useBreakpoint'
import type { HelpTopicId } from '@tinycld/core/lib/help/types'
import { captureException } from '@tinycld/core/lib/errors'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useCurrentRole } from '@tinycld/core/lib/use-current-role'
import { Button, ButtonText } from '@tinycld/core/ui/button'
import { Modal, ModalBackdrop, ModalContent } from '@tinycld/core/ui/modal'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import {
    ArrowLeft,
    ChevronRight,
    Download,
    Eye,
    FileUp,
    FolderInput,
    FolderPlus,
    Grid,
    Image as ImageIcon,
    Info,
    List,
    Pencil,
    RotateCcw,
    Search,
    Trash2,
    Upload,
    UserPlus,
    X,
} from 'lucide-react-native'
import { useCallback, useMemo, useState } from 'react'
import { Platform, Pressable, Text, View } from 'react-native'
import { useDrive } from '../hooks/useDrive'
import { type PromptDialog, useDriveUIStore } from '../stores/drive-ui-store'
import type { DriveItemView, ViewMode } from '../types'
import { ChooseFolderDialog } from './ChooseFolderDialog'
import { ShareDialog } from './ShareDialog'
import { UploadButton } from './UploadButton'

export function DriveDialogs() {
    const {
        moveTarget,
        moveItem,
        selectItem,
        selectedIds,
        clearSelection,
        closeMoveDialog,
        shareTarget,
        getSharesForItem,
        orgMembers,
        removeShare,
        closeShareDialog,
        folderTree,
    } = useDrive()
    const { userOrgId } = useCurrentRole()

    const isMultiMove = moveTarget?.id === '__multi__'

    const handleMove = (targetId: string) => {
        if (!moveTarget) return
        if (isMultiMove) {
            for (const id of selectedIds) moveItem(id, targetId)
            clearSelection()
        } else {
            moveItem(moveTarget.id, targetId)
        }
        selectItem(null)
    }

    return (
        <>
            <NamePromptDialog />
            <UploadSheet />
            <ChooseFolderDialog
                open={moveTarget !== null}
                itemName={moveTarget?.name ?? ''}
                excludeId={isMultiMove ? '' : (moveTarget?.id ?? '')}
                folderTree={folderTree}
                onMove={handleMove}
                onClose={closeMoveDialog}
            />
            <ShareDialog
                open={shareTarget !== null}
                itemId={shareTarget?.id ?? ''}
                itemName={shareTarget?.name ?? ''}
                shares={shareTarget ? getSharesForItem(shareTarget.id) : []}
                orgMembers={orgMembers}
                currentUserOrgId={userOrgId}
                onRemoveShare={removeShare}
                onClose={closeShareDialog}
            />
        </>
    )
}

function helpTopicForSection(activeSection: string, isSearchActive: boolean): HelpTopicId {
    if (isSearchActive) return 'drive:search'
    if (activeSection === 'trash') return 'drive:trash'
    if (activeSection === 'shared-with-me') return 'drive:sharing'
    return 'drive:files'
}

export function DriveToolbar() {
    const mutedColor = useThemeColor('muted-foreground')
    const fgColor = useThemeColor('foreground')
    const activeIndicator = useThemeColor('active-indicator')
    const isMobile = useBreakpoint() === 'mobile'
    const openUploadSheet = useDriveUIStore((s) => s.openUploadSheet)
    const {
        selectedItem,
        selectedIds,
        clearSelection,
        activeSection,
        breadcrumbs,
        viewMode,
        setViewMode,
        selectItem,
        navigateToFolder,
        searchQuery,
        setSearchQuery,
        isSearching,
        moveToTrash,
        openPrompt,
        openMoveDialog,
        openShareDialog,
    } = useDrive()

    const selectionCount = selectedIds.size
    // Single-item selection is already conveyed by the row highlight + the
    // detail panel; the row's hover actions cover Preview/Share/etc. The
    // selection toolbar only adds value when bulk-acting on 2+ items, or
    // in Trash where Restore/Delete-permanently aren't on the row. Showing
    // it for a single click also masks the breadcrumb header, which makes
    // the X-icon + filename pair look like an unrelated decoration.
    const showSelectionToolbar = selectionCount > 1 || (activeSection === 'trash' && selectionCount > 0)

    if (showSelectionToolbar) {
        const handleClear = () => {
            selectItem(null)
            clearSelection()
        }

        return (
            <SelectionToolbar
                selectedIds={selectedIds}
                selectedItem={selectedItem}
                selectionCount={selectionCount}
                viewMode={viewMode}
                onSetViewMode={setViewMode}
                onClearSelection={handleClear}
                onOpenRename={(itemId, name) => openPrompt({ type: 'rename', itemId, currentName: name })}
                onOpenMove={(itemId, name) => openMoveDialog(itemId, name)}
                onOpenShare={(itemId, name) => openShareDialog(itemId, name)}
                mutedColor={mutedColor}
                fgColor={fgColor}
                activeIndicator={activeIndicator}
            />
        )
    }

    const isSearchActive = searchQuery.length >= 2
    const helpTopic = helpTopicForSection(activeSection, isSearchActive)

    const currentFolder = breadcrumbs.at(-1)
    const currentLabel = currentFolder?.name ?? 'My Files'

    // Rename / Delete act on the currently-selected item, so they only
    // appear once exactly one item is selected. Without a selection the
    // toolbar shows just creation actions; with two or more items selected,
    // we render the multi-select SelectionToolbar instead (handled above).
    const hasSingleSelection = selectionCount === 1 && selectedItem !== undefined
    const handleRenameSelected = hasSingleSelection
        ? () =>
              openPrompt({
                  type: 'rename',
                  itemId: selectedItem.id,
                  currentName: selectedItem.name,
              })
        : undefined
    const handleTrashSelected = hasSingleSelection
        ? () => {
              moveToTrash(selectedItem.id)
              selectItem(null)
              clearSelection()
          }
        : undefined

    const folderActions = (
        <View className="flex-row items-center gap-0.5">
            <UploadButton onMobilePress={openUploadSheet} />
            <ToolbarIconButton
                icon={FolderPlus}
                label="New folder"
                onPress={() => openPrompt({ type: 'new-folder' })}
            />
            {hasSingleSelection && handleRenameSelected && (
                <ToolbarIconButton icon={Pencil} label="Rename" onPress={handleRenameSelected} />
            )}
            {hasSingleSelection && handleTrashSelected && selectedItem && (
                <ConfirmTrash itemName={selectedItem.name} onConfirmed={handleTrashSelected}>
                    {(onOpen) => <ToolbarIconButton icon={Trash2} label="Delete" onPress={onOpen} />}
                </ConfirmTrash>
            )}
        </View>
    )

    const titleContent = (() => {
        if (isSearchActive) {
            return (
                <Text
                    className="flex-1 text-muted-foreground"
                    style={{
                        fontSize: 13,
                        fontWeight: '500',
                    }}
                >
                    Search results{isSearching ? '...' : ''}
                </Text>
            )
        }
        if (activeSection === 'trash') {
            return (
                <Text
                    className="flex-1 text-foreground"
                    style={{
                        fontSize: 24,
                        fontWeight: '500',
                    }}
                >
                    Trash
                </Text>
            )
        }
        if (isMobile) {
            return (
                <MobileBreadcrumbs
                    breadcrumbs={breadcrumbs}
                    currentLabel={currentLabel}
                    onNavigate={navigateToFolder}
                    fgColor={fgColor}
                />
            )
        }
        return (
            <DesktopBreadcrumbs
                breadcrumbs={breadcrumbs}
                currentLabel={currentLabel}
                onNavigate={navigateToFolder}
                fgColor={fgColor}
                mutedColor={mutedColor}
            />
        )
    })()

    return (
        <ScreenHeader>
            {isMobile ? (
                <View className="px-4 gap-2" style={{ paddingVertical: 10 }}>
                    <View className="flex-row items-center justify-between gap-2">
                        {titleContent}
                        {folderActions}
                        <ViewToggle
                            viewMode={viewMode}
                            onSetViewMode={setViewMode}
                            mutedColor={mutedColor}
                            activeIndicator={activeIndicator}
                        />
                        <HelpIcon topic={helpTopic} size={18} />
                    </View>
                    <SearchInput
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        mutedColor={mutedColor}
                        fgColor={fgColor}
                        fullWidth
                    />
                </View>
            ) : (
                <View className="flex-row items-center justify-between px-4 gap-3" style={{ paddingVertical: 10 }}>
                    {titleContent}
                    <ToolbarSeparator />
                    {folderActions}
                    <ToolbarSeparator />
                    <View className="flex-row items-center gap-2 shrink-0">
                        <SearchInput
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                            mutedColor={mutedColor}
                            fgColor={fgColor}
                        />
                        <ViewToggle
                            viewMode={viewMode}
                            onSetViewMode={setViewMode}
                            mutedColor={mutedColor}
                            activeIndicator={activeIndicator}
                        />
                        <HelpIcon topic={helpTopic} size={18} />
                    </View>
                </View>
            )}
        </ScreenHeader>
    )
}

function DesktopBreadcrumbs({
    breadcrumbs,
    currentLabel,
    onNavigate,
    fgColor: _fgColor,
    mutedColor,
}: {
    breadcrumbs: DriveItemView[]
    currentLabel: string
    onNavigate: (folderId: string) => void
    fgColor: string
    mutedColor: string
}) {
    const ancestors = breadcrumbs.slice(0, -1)

    return (
        <View className="flex-row items-center flex-1 gap-1 overflow-hidden" style={{ minWidth: 0 }}>
            {ancestors.length > 0 && (
                <>
                    <Pressable onPress={() => onNavigate('')}>
                        <Text numberOfLines={1} className="text-muted-foreground" style={{ fontSize: 16 }}>
                            My Files
                        </Text>
                    </Pressable>
                    <ChevronRight size={14} color={mutedColor} />
                </>
            )}
            {ancestors.map((crumb) => (
                <View key={crumb.id} className="flex-row items-center gap-1 shrink" style={{ minWidth: 0 }}>
                    <Pressable onPress={() => onNavigate(crumb.id)}>
                        <Text
                            numberOfLines={1}
                            className="text-muted-foreground"
                            style={{
                                fontSize: 16,
                                flexShrink: 1,
                            }}
                        >
                            {crumb.name}
                        </Text>
                    </Pressable>
                    <ChevronRight size={14} color={mutedColor} />
                </View>
            ))}
            <Text
                numberOfLines={1}
                className="text-foreground"
                style={{
                    fontSize: 20,
                    fontWeight: '600',
                    flexShrink: 1,
                }}
            >
                {currentLabel}
            </Text>
        </View>
    )
}

function MobileBreadcrumbs({
    breadcrumbs,
    currentLabel,
    onNavigate,
    fgColor,
}: {
    breadcrumbs: DriveItemView[]
    currentLabel: string
    onNavigate: (folderId: string) => void
    fgColor: string
}) {
    // breadcrumbs.length === 0 → at root ("My Files"), no back. ≥1 means
    // we're inside a folder; even one level deep needs a back button so
    // mobile users can leave without opening the side nav.
    const isInsideFolder = breadcrumbs.length >= 1
    const parent = breadcrumbs.at(-2)

    const goUp = () => {
        if (parent) onNavigate(parent.id)
        else onNavigate('')
    }

    return (
        <View className="flex-row items-center flex-1" style={{ gap: 6, minWidth: 0 }}>
            {isInsideFolder && (
                <Pressable
                    onPress={goUp}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Go up"
                >
                    <ArrowLeft size={20} color={fgColor} />
                </Pressable>
            )}
            <Text
                numberOfLines={1}
                className="text-foreground"
                style={{
                    fontSize: 20,
                    fontWeight: '600',
                    flex: 1,
                }}
            >
                {currentLabel}
            </Text>
        </View>
    )
}

interface SearchInputProps {
    value: string
    onChangeText: (text: string) => void
    mutedColor: string
    fgColor: string
    fullWidth?: boolean
}

function SearchInput({ value, onChangeText, mutedColor, fgColor: _fgColor, fullWidth }: SearchInputProps) {
    return (
        <View
            className="flex-row items-center border border-border rounded-lg"
            style={{
                gap: 6,
                paddingHorizontal: 10,
                paddingVertical: 6,
                width: fullWidth ? '100%' : 240,
            }}
        >
            <Search size={14} color={mutedColor} />
            <PlainInput
                className="flex-1 p-0 text-foreground"
                style={{ fontSize: 13 }}
                placeholder="Search in Files"
                placeholderTextColor={mutedColor}
                value={value}
                onChangeText={onChangeText}
            />
            {value.length > 0 && (
                <Pressable onPress={() => onChangeText('')} hitSlop={8}>
                    <X size={14} color={mutedColor} />
                </Pressable>
            )}
        </View>
    )
}

interface SelectionToolbarProps {
    selectedIds: Set<string>
    selectedItem: DriveItemView | undefined
    selectionCount: number
    viewMode: ViewMode
    onSetViewMode: (mode: ViewMode) => void
    onClearSelection: () => void
    onOpenRename: (itemId: string, currentName: string) => void
    onOpenMove: (itemId: string, name: string) => void
    onOpenShare: (itemId: string, name: string) => void
    mutedColor: string
    fgColor: string
    activeIndicator: string
}

function SelectionToolbar({
    selectedIds,
    selectedItem,
    selectionCount,
    viewMode,
    onSetViewMode,
    onClearSelection,
    onOpenRename,
    onOpenMove,
    onOpenShare,
    mutedColor,
    fgColor: _fgColor,
    activeIndicator,
}: SelectionToolbarProps) {
    const {
        activeSection,
        uploadNewVersion,
        downloadItem,
        moveToTrash,
        restoreFromTrash,
        permanentlyDelete,
        canRestoreToOriginalLocation,
        restoreToFolder,
        folderTree,
        openPreview,
        toggleDetailPanel,
    } = useDrive()
    const [restoreMoveTarget, setRestoreMoveTarget] = useState<string | null>(null)

    const isTrash = activeSection === 'trash'
    const isSingle = selectionCount <= 1
    const item = selectedItem
    const selectedIdArray = useMemo(() => [...selectedIds], [selectedIds])

    const displayLabel = isSingle ? (item?.name ?? '') : `${selectionCount} selected`

    const triggerVersionUpload = useCallback(() => {
        if (Platform.OS === 'web' && item) {
            const input = document.createElement('input')
            input.type = 'file'
            input.onchange = () => {
                if (input.files?.[0]) {
                    uploadNewVersion(item.id, input.files[0]).catch((err) => captureException('uploadNewVersion', err))
                }
            }
            input.click()
        }
    }, [uploadNewVersion, item])

    const handleDownloadAll = useCallback(() => {
        for (const id of selectedIdArray) downloadItem(id)
    }, [selectedIdArray, downloadItem])

    const handleTrashAll = useCallback(() => {
        for (const id of selectedIdArray) moveToTrash(id)
        onClearSelection()
    }, [selectedIdArray, moveToTrash, onClearSelection])

    const toolbarItems: ToolbarItem[] = useMemo(() => {
        const items: ToolbarItem[] = [
            {
                type: 'custom',
                key: 'close',
                element: (
                    <Pressable onPress={onClearSelection} className="p-1">
                        <X size={16} color={mutedColor} />
                    </Pressable>
                ),
            },
            {
                type: 'custom',
                key: 'name',
                element: (
                    <Text
                        numberOfLines={1}
                        className="flex-1 text-foreground"
                        style={{ fontSize: 13, fontWeight: '500' }}
                    >
                        {displayLabel}
                    </Text>
                ),
            },
        ]

        if (isSingle && item && !item.isFolder) {
            items.push(
                {
                    type: 'button',
                    key: 'preview',
                    icon: Eye,
                    label: 'Preview',
                    onPress: () => {
                        if (selectedItem) openPreview(selectedItem)
                    },
                },
                {
                    type: 'button',
                    key: 'upload-version',
                    icon: Upload,
                    label: 'Upload new version',
                    onPress: triggerVersionUpload,
                }
            )
        }

        if (isSingle && item) {
            items.push(
                {
                    type: 'button',
                    key: 'share',
                    icon: UserPlus,
                    label: 'Share',
                    onPress: () => onOpenShare(item.id, item.name),
                },
                {
                    type: 'button',
                    key: 'rename',
                    icon: Pencil,
                    label: 'Rename',
                    onPress: () => onOpenRename(item.id, item.name),
                },
                {
                    type: 'button',
                    key: 'info',
                    icon: Info,
                    label: 'Info',
                    onPress: toggleDetailPanel,
                }
            )
        }

        // Multi-capable actions: download, move, trash
        items.push(
            {
                type: 'button',
                key: 'download',
                icon: Download,
                label: 'Download',
                onPress: isSingle && item ? () => downloadItem(item.id) : handleDownloadAll,
            },
            {
                type: 'button',
                key: 'move',
                icon: FolderInput,
                label: 'Move',
                onPress:
                    isSingle && item
                        ? () => onOpenMove(item.id, item.name)
                        : () => onOpenMove('__multi__', `${selectionCount} items`),
            },
            {
                type: 'custom',
                key: 'trash',
                element: (
                    <ConfirmTrash
                        itemName={isSingle && item ? item.name : `${selectionCount} items`}
                        onConfirmed={
                            isSingle && item
                                ? () => {
                                      moveToTrash(item.id)
                                      onClearSelection()
                                  }
                                : handleTrashAll
                        }
                    >
                        {(onOpen) => <ToolbarIconButton icon={Trash2} label="Trash" onPress={onOpen} />}
                    </ConfirmTrash>
                ),
            }
        )

        return items
    }, [
        isSingle,
        item,
        displayLabel,
        selectionCount,
        mutedColor,
        selectedItem,
        openPreview,
        triggerVersionUpload,
        onOpenShare,
        downloadItem,
        handleDownloadAll,
        onOpenRename,
        onOpenMove,
        moveToTrash,
        handleTrashAll,
        onClearSelection,
        toggleDetailPanel,
    ])

    const rightItems: ToolbarItem[] = useMemo(
        () => [
            {
                type: 'custom',
                key: 'view-toggle',
                element: (
                    <ViewToggle
                        viewMode={viewMode}
                        onSetViewMode={onSetViewMode}
                        mutedColor={mutedColor}
                        activeIndicator={activeIndicator}
                    />
                ),
            },
        ],
        [viewMode, onSetViewMode, mutedColor, activeIndicator]
    )

    if (isTrash) {
        const handleRestoreAll = () => {
            for (const id of selectedIdArray) {
                if (canRestoreToOriginalLocation(id)) restoreFromTrash(id)
            }
            onClearSelection()
        }

        const handleDeleteAll = () => {
            for (const id of selectedIdArray) permanentlyDelete(id)
            onClearSelection()
        }

        const handleRestoreSingle = () => {
            if (!item) return
            if (canRestoreToOriginalLocation(item.id)) {
                restoreFromTrash(item.id)
                onClearSelection()
            } else {
                setRestoreMoveTarget(item.id)
            }
        }

        return (
            <>
                <ScreenHeader>
                    <View className="flex-row items-center justify-between px-4" style={{ paddingVertical: 10 }}>
                        <View className="flex-row items-center gap-2 flex-1">
                            <Pressable onPress={onClearSelection} className="p-1">
                                <X size={16} color={mutedColor} />
                            </Pressable>
                            <Text
                                numberOfLines={1}
                                className="flex-1 text-foreground"
                                style={{
                                    fontSize: 13,
                                    fontWeight: '500',
                                }}
                            >
                                {displayLabel}
                            </Text>
                        </View>
                        <View className="flex-row items-center gap-1">
                            <ToolbarIconButton
                                icon={RotateCcw}
                                label="Restore"
                                onPress={isSingle ? handleRestoreSingle : handleRestoreAll}
                            />
                            <SuretyGuard
                                message={
                                    isSingle && item
                                        ? `Permanently delete "${item.name}"? This cannot be undone.`
                                        : `Permanently delete ${selectionCount} items? This cannot be undone.`
                                }
                                confirmLabel="Delete permanently"
                                onConfirmed={
                                    isSingle && item
                                        ? () => {
                                              permanentlyDelete(item.id)
                                              onClearSelection()
                                          }
                                        : handleDeleteAll
                                }
                            >
                                {(onOpen) => (
                                    <ToolbarIconButton icon={Trash2} label="Delete permanently" onPress={onOpen} />
                                )}
                            </SuretyGuard>
                            <ToolbarSeparator />
                            <ViewToggle
                                viewMode={viewMode}
                                onSetViewMode={onSetViewMode}
                                mutedColor={mutedColor}
                                activeIndicator={activeIndicator}
                            />
                        </View>
                    </View>
                </ScreenHeader>
                {item && isSingle && (
                    <ChooseFolderDialog
                        open={restoreMoveTarget !== null}
                        itemName={item.name}
                        excludeId={item.id}
                        folderTree={folderTree}
                        title="Original location has been removed, select alternative location"
                        confirmLabel="Restore here"
                        onMove={(targetId) => {
                            if (restoreMoveTarget) {
                                restoreToFolder(restoreMoveTarget, targetId)
                                onClearSelection()
                            }
                        }}
                        onClose={() => setRestoreMoveTarget(null)}
                    />
                )}
            </>
        )
    }

    return (
        <ScreenHeader>
            <View style={{ paddingVertical: 10, paddingHorizontal: 8 }}>
                <ResponsiveToolbar items={toolbarItems} rightItems={rightItems} />
            </View>
        </ScreenHeader>
    )
}

interface ViewToggleProps {
    viewMode: ViewMode
    onSetViewMode: (mode: ViewMode) => void
    mutedColor: string
    activeIndicator: string
}

function ViewToggle({ viewMode, onSetViewMode, mutedColor, activeIndicator }: ViewToggleProps) {
    return (
        <View
            accessibilityRole="tablist"
            accessibilityLabel="View mode"
            className="flex-row rounded-lg border border-border bg-surface-secondary p-0.5"
        >
            <ViewToggleSegment
                testID="drive-view-list"
                label="List"
                icon={List}
                isActive={viewMode === 'list'}
                onPress={() => onSetViewMode('list')}
                mutedColor={mutedColor}
                activeIndicator={activeIndicator}
            />
            <ViewToggleSegment
                testID="drive-view-grid"
                label="Grid"
                icon={Grid}
                isActive={viewMode === 'grid'}
                onPress={() => onSetViewMode('grid')}
                mutedColor={mutedColor}
                activeIndicator={activeIndicator}
            />
        </View>
    )
}

interface ViewToggleSegmentProps {
    testID: string
    label: string
    icon: typeof List
    isActive: boolean
    onPress: () => void
    mutedColor: string
    activeIndicator: string
}

function ViewToggleSegment({
    testID,
    label,
    icon: Icon,
    isActive,
    onPress,
    mutedColor,
    activeIndicator,
}: ViewToggleSegmentProps) {
    const iconColor = isActive ? activeIndicator : mutedColor
    return (
        <Pressable
            testID={testID}
            onPress={onPress}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={`${label} view`}
            className={`flex-row items-center gap-1.5 rounded-md px-3 py-1.5 ${
                isActive ? 'bg-background shadow-sm' : ''
            }`}
            style={
                isActive
                    ? {
                          // Soft elevation so the selected pill clearly sits
                          // above the track on light + dark themes.
                          shadowColor: '#000',
                          shadowOffset: { width: 0, height: 1 },
                          shadowOpacity: 0.08,
                          shadowRadius: 2,
                          elevation: 1,
                      }
                    : undefined
            }
        >
            <Icon size={16} color={iconColor} />
            <Text
                className={isActive ? 'text-foreground' : 'text-muted-foreground'}
                style={{ fontSize: 13, fontWeight: isActive ? '600' : '500' }}
            >
                {label}
            </Text>
        </Pressable>
    )
}

function NamePromptDialog() {
    const promptDialog = useDriveUIStore((s) => s.promptDialog)
    const promptKey = useDriveUIStore((s) => s.promptKey)

    if (promptDialog.type === 'closed') return null

    return <NamePromptDialogInner key={promptKey} prompt={promptDialog} />
}

function NamePromptDialogInner({ prompt }: { prompt: Exclude<PromptDialog, { type: 'closed' }> }) {
    const { handlePromptSubmit, closePrompt } = useDrive()

    const isNewFolder = prompt.type === 'new-folder'
    const title = isNewFolder ? 'New folder' : 'Rename'
    const placeholder = isNewFolder ? 'Untitled folder' : ''
    const submitLabel = isNewFolder ? 'Create' : 'Rename'
    const initialValue = prompt.type === 'rename' ? prompt.currentName : ''

    const [value, setValue] = useState(initialValue)

    const handleSubmit = () => {
        const trimmed = value.trim()
        if (trimmed) handlePromptSubmit(trimmed)
    }

    return (
        <Modal isOpen onClose={closePrompt}>
            <ModalBackdrop />
            <ModalContent className="w-[360px] p-4 gap-3">
                <Text className="text-foreground" style={{ fontSize: 20, fontWeight: '600' }}>
                    {title}
                </Text>
                <View className="flex-row border border-border rounded-lg px-3" style={{ paddingVertical: 10 }}>
                    <PlainInput
                        value={value}
                        onChangeText={setValue}
                        placeholder={placeholder}
                        autoFocus
                        onSubmitEditing={handleSubmit}
                        className="flex-1 text-foreground"
                        style={{ fontSize: 15 }}
                    />
                </View>
                <View className="flex-row gap-3 justify-end">
                    <Pressable onPress={closePrompt} className="px-3 py-2">
                        <Text className="text-foreground" style={{ fontSize: 13 }}>
                            Cancel
                        </Text>
                    </Pressable>
                    <Button onPress={handleSubmit} isDisabled={!value.trim()} size="sm">
                        <ButtonText>{submitLabel}</ButtonText>
                    </Button>
                </View>
            </ModalContent>
        </Modal>
    )
}

function UploadSheet() {
    const isOpen = useDriveUIStore((s) => s.uploadSheetOpen)
    const closeUploadSheet = useDriveUIStore((s) => s.closeUploadSheet)
    const { triggerFilePicker, triggerPhotoPicker } = useDrive()
    const fgColor = useThemeColor('foreground')

    if (!isOpen) return null

    const handlePickPhotos = () => {
        closeUploadSheet()
        triggerPhotoPicker()
    }
    const handlePickFile = () => {
        closeUploadSheet()
        triggerFilePicker()
    }

    return (
        <View
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 1000,
                justifyContent: 'flex-end',
            }}
        >
            <Pressable
                onPress={closeUploadSheet}
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.5)',
                }}
            />
            <View
                className="bg-background"
                style={{
                    borderTopLeftRadius: 20,
                    borderTopRightRadius: 20,
                    paddingBottom: 24,
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: -4 },
                    shadowOpacity: 0.15,
                    shadowRadius: 12,
                    elevation: 16,
                }}
            >
                <View
                    className="bg-muted-foreground/40"
                    style={{
                        alignSelf: 'center',
                        width: 36,
                        height: 4,
                        borderRadius: 2,
                        marginTop: 8,
                        marginBottom: 8,
                    }}
                />
                <SheetAction icon={ImageIcon} label="Photos & videos" onPress={handlePickPhotos} fgColor={fgColor} />
                <View className="bg-border" style={{ height: 1, marginHorizontal: 16 }} />
                <SheetAction icon={FileUp} label="File" onPress={handlePickFile} fgColor={fgColor} />
            </View>
        </View>
    )
}

function SheetAction({
    icon: Icon,
    label,
    onPress,
    fgColor,
}: {
    icon: typeof FileUp
    label: string
    onPress: () => void
    fgColor: string
}) {
    return (
        <Pressable onPress={onPress} className="flex-row items-center gap-4 py-4 px-5">
            <Icon size={22} color={fgColor} />
            <Text className="text-foreground" style={{ fontSize: 16, fontWeight: '500' }}>
                {label}
            </Text>
        </Pressable>
    )
}
