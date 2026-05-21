import { formatBytes, formatDate } from '@tinycld/core/lib/format-utils'
import { pb } from '@tinycld/core/lib/pocketbase'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import {
    Drawer,
    DrawerBackdrop,
    DrawerBody,
    DrawerCloseButton,
    DrawerContent,
    DrawerHeader,
} from '@tinycld/core/ui/drawer'
import { Modal, ModalBackdrop, ModalContent } from '@tinycld/core/ui/modal'
import { Download, FolderOpen, RotateCcw, X } from 'lucide-react-native'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { useDrive } from '../hooks/useDrive'
import { useVersionHistory } from '../hooks/useVersionHistory'
import type { DriveItemView } from '../types'
import { Thumbnail } from './Thumbnail'

interface DetailPanelProps {
    isVisible: boolean
    item: DriveItemView | undefined
    onClose: () => void
}

// The detail panel is a right-anchored Drawer overlay (with a
// backdrop that dismisses on tap-away) rather than an inline flex
// sibling of the file list. The Drawer itself manages mount/unmount
// animation when isOpen flips, so we keep it mounted as long as we
// have an item to show — guarding on isVisible only at the isOpen
// prop keeps the slide-out animation playing during close.
//
// `useDrive()` is read HERE — inside the DriveStateProvider — and the
// pieces the inner panel needs are threaded down as props. Gluestack's
// overlay renders the drawer through a top-level PortalProvider that
// re-roots the subtree as a sibling of the entire app, so any context
// installed *inside* the drive tree (DriveStateProvider) is invisible
// to components rendered inside <Drawer>. Lifting the read avoids the
// "useDrive must be called within a <DriveStateProvider>" crash that
// follows from a naive useDrive() call inside the drawer subtree.
export function DetailPanel({ isVisible, item, onClose }: DetailPanelProps) {
    const { activeSection, getItemPath } = useDrive()
    if (!item) return null
    return (
        <DetailPanelContent
            item={item}
            isOpen={isVisible}
            onClose={onClose}
            activeSection={activeSection}
            getItemPath={getItemPath}
        />
    )
}

type DriveContextSlice = {
    activeSection: ReturnType<typeof useDrive>['activeSection']
    getItemPath: ReturnType<typeof useDrive>['getItemPath']
}

type DetailTab = 'details' | 'versions' | 'activity'

function DetailPanelContent({
    item,
    isOpen,
    onClose,
    activeSection,
    getItemPath,
}: {
    item: DriveItemView
    isOpen: boolean
    onClose: () => void
} & DriveContextSlice) {
    const mutedColor = useThemeColor('muted-foreground')
    const primaryColor = useThemeColor('primary')
    const [activeTab, setActiveTab] = useState<DetailTab>('details')
    const showVersionsTab = !item.isFolder

    return (
        <Drawer isOpen={isOpen} onClose={onClose} anchor="right" size="md">
            <DrawerBackdrop />
            <DrawerContent>
                <DrawerHeader>
                    <Text
                        numberOfLines={2}
                        className="flex-1 text-foreground"
                        style={{ fontSize: 16, fontWeight: '600' }}
                    >
                        {item.name}
                    </Text>
                    <DrawerCloseButton accessibilityLabel="Close details panel">
                        <X size={18} color={mutedColor} />
                    </DrawerCloseButton>
                </DrawerHeader>
                <DrawerBody>
                    <View className="items-center py-6">
                        <Thumbnail item={item} size={120} />
                    </View>

                    <TabBar
                        tabs={
                            showVersionsTab
                                ? (['details', 'versions', 'activity'] as const)
                                : (['details', 'activity'] as const)
                        }
                        activeTab={activeTab}
                        onTabPress={setActiveTab}
                        mutedColor={mutedColor}
                        primaryColor={primaryColor}
                    />

                    {activeTab === 'details' && (
                        <DetailsContent
                            item={item}
                            activeSection={activeSection}
                            getItemPath={getItemPath}
                        />
                    )}
                    {activeTab === 'versions' && showVersionsTab && (
                        <VersionsContent itemId={item.id} />
                    )}
                    {activeTab === 'activity' && <ActivityContent />}
                </DrawerBody>
            </DrawerContent>
        </Drawer>
    )
}

function DetailsContent({
    item,
    activeSection,
    getItemPath,
}: { item: DriveItemView } & DriveContextSlice) {
    const mutedColor = useThemeColor('muted-foreground')
    const accessText = item.shared ? 'Shared with others' : 'Private to you'
    const isTrash = activeSection === 'trash'
    const originalLocation = isTrash ? getItemPath(item.parentId) : null

    return (
        <View className="p-4">
            {isTrash && (
                <>
                    <View className="gap-2">
                        <Text
                            className="mb-1 text-foreground"
                            style={{
                                fontSize: 13,
                                fontWeight: '600',
                            }}
                        >
                            Original location
                        </Text>
                        <View className="flex-row items-center gap-2">
                            <FolderOpen size={16} color={mutedColor} />
                            <Text className="text-muted-foreground" style={{ fontSize: 12 }}>
                                {originalLocation}
                            </Text>
                        </View>
                        <DetailRow label="Deleted" value={formatDate(item.trashedAt)} />
                    </View>

                    <View className="my-4 bg-border" style={{ height: 1 }} />
                </>
            )}

            <View className="gap-2">
                <Text
                    className="mb-1 text-foreground"
                    style={{
                        fontSize: 13,
                        fontWeight: '600',
                    }}
                >
                    Who has access
                </Text>
                <View className="flex-row items-center gap-2">
                    <View className="size-7 items-center justify-center bg-accent" style={{ borderRadius: 14 }}>
                        <Text
                            className="text-accent-foreground"
                            style={{
                                fontSize: 11,
                                fontWeight: '600',
                            }}
                        >
                            {item.owner === 'me' ? 'Y' : item.owner.charAt(0)}
                        </Text>
                    </View>
                    <Text className="text-muted-foreground" style={{ fontSize: 12 }}>
                        {accessText}
                    </Text>
                </View>
            </View>

            <View className="my-4 bg-border" style={{ height: 1 }} />

            <View className="gap-2">
                <Text
                    className="mb-1 text-foreground"
                    style={{
                        fontSize: 13,
                        fontWeight: '600',
                    }}
                >
                    File details
                </Text>
                <DetailRow label="Type" value={item.mimeType} />
                <DetailRow label="Size" value={formatBytes(item.size)} />
                <DetailRow label="Owner" value={item.owner} />
                <DetailRow label="Modified" value={formatDate(item.updated)} />
            </View>
        </View>
    )
}

function DetailRow({ label, value }: { label: string; value: string; mutedColor?: string; fgColor?: string }) {
    return (
        <View className="flex-row py-1">
            <Text className="text-muted-foreground" style={{ fontSize: 12, width: 80 }}>
                {label}
            </Text>
            <Text numberOfLines={1} className="flex-1 text-foreground" style={{ fontSize: 12 }}>
                {value}
            </Text>
        </View>
    )
}

interface TabBarProps {
    tabs: readonly DetailTab[]
    activeTab: DetailTab
    onTabPress: (tab: DetailTab) => void
    mutedColor: string
    primaryColor: string
}

function TabBar({ tabs, activeTab, onTabPress, mutedColor, primaryColor }: TabBarProps) {
    const labels: Record<DetailTab, string> = {
        details: 'Details',
        versions: 'Versions',
        activity: 'Activity',
    }

    return (
        <View className="flex-row border-b border-border">
            {tabs.map((tab) => (
                <Pressable
                    key={tab}
                    className="flex-1 items-center"
                    style={{
                        paddingVertical: 10,
                        ...(activeTab === tab
                            ? {
                                  borderBottomColor: primaryColor,
                                  borderBottomWidth: 2,
                              }
                            : {}),
                    }}
                    onPress={() => onTabPress(tab)}
                >
                    <Text
                        style={{
                            fontSize: 13,
                            fontWeight: '500',
                            color: activeTab === tab ? primaryColor : mutedColor,
                        }}
                    >
                        {labels[tab]}
                    </Text>
                </Pressable>
            ))}
        </View>
    )
}

function VersionsContent({ itemId }: { itemId: string }) {
    const { versions, restoreVersion, isRestoring } = useVersionHistory(itemId)
    const [confirmVersionId, setConfirmVersionId] = useState<string | null>(null)

    const confirmingVersion = confirmVersionId ? versions.find((v) => v.id === confirmVersionId) : null

    const handleConfirmRestore = useCallback(() => {
        if (!confirmVersionId) return
        restoreVersion(confirmVersionId)
        setConfirmVersionId(null)
    }, [confirmVersionId, restoreVersion])

    const handleDownload = useCallback((version: { id: string; file: string }) => {
        const url = pb.files.getURL(
            {
                id: version.id,
                collectionId: 'pbc_drive_versions_01',
                collectionName: 'drive_item_versions',
            },
            version.file
        )
        if (typeof window !== 'undefined') {
            window.open(url, '_blank')
        }
    }, [])

    if (versions.length === 0) {
        return (
            <View className="p-4">
                <NeutralMessage>No previous versions</NeutralMessage>
            </View>
        )
    }

    return (
        <>
            <View className="p-4">
                {versions.map((version) => (
                    <VersionRow
                        key={version.id}
                        version={version}
                        onRestore={() => setConfirmVersionId(version.id)}
                        onDownload={() => handleDownload(version)}
                        isRestoring={isRestoring}
                    />
                ))}
            </View>

            <RestoreConfirmDialog
                open={!!confirmingVersion}
                onOpenChange={(open) => {
                    if (!open) setConfirmVersionId(null)
                }}
                versionNumber={confirmingVersion?.version_number ?? 0}
                onConfirm={handleConfirmRestore}
            />
        </>
    )
}

interface RestoreConfirmDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    versionNumber: number
    onConfirm: () => void
}

function RestoreConfirmDialog({ open, onOpenChange, versionNumber, onConfirm }: RestoreConfirmDialogProps) {
    return (
        <Modal isOpen={open} onClose={() => onOpenChange(false)}>
            <ModalBackdrop />
            <ModalContent className="w-[340px] p-4 gap-3">
                <Text className="text-foreground" style={{ fontSize: 20, fontWeight: '600' }}>
                    Restore version
                </Text>
                <Text className="text-muted-foreground" style={{ fontSize: 13 }}>
                    Restore to version {versionNumber}? The current file will be saved as a new version before
                    restoring.
                </Text>
                <View className="flex-row gap-3 justify-end">
                    <Pressable onPress={() => onOpenChange(false)} className="px-3 py-2">
                        <Text className="text-foreground" style={{ fontSize: 13 }}>
                            Cancel
                        </Text>
                    </Pressable>
                    <Pressable
                        onPress={() => {
                            onConfirm()
                            onOpenChange(false)
                        }}
                        className="px-4 py-2 rounded-md bg-primary"
                    >
                        <Text className="text-primary-foreground" style={{ fontWeight: '600' }}>
                            Restore
                        </Text>
                    </Pressable>
                </View>
            </ModalContent>
        </Modal>
    )
}

interface VersionRowProps {
    version: {
        id: string
        version_number: number
        size: number
        created: string
        file: string
    }
    onRestore: () => void
    onDownload: () => void
    isRestoring: boolean
}

function VersionRow({ version, onRestore, onDownload, isRestoring }: VersionRowProps) {
    const mutedColor = useThemeColor('muted-foreground')

    return (
        <View className="flex-row items-center justify-between border-b border-border" style={{ paddingVertical: 10 }}>
            <View className="flex-1 gap-0.5">
                <Text className="text-foreground" style={{ fontSize: 12, fontWeight: '500' }}>
                    Version {version.version_number}
                </Text>
                <Text className="text-muted-foreground" style={{ fontSize: 11 }}>
                    {formatDate(version.created)} · {formatBytes(version.size)}
                </Text>
            </View>
            <View className="flex-row gap-2">
                <Pressable onPress={onDownload} hitSlop={8} className="p-1">
                    <Download size={14} color={mutedColor} />
                </Pressable>
                <Pressable onPress={onRestore} hitSlop={8} disabled={isRestoring} className="p-1">
                    {isRestoring ? <ActivityIndicator size="small" /> : <RotateCcw size={14} color={mutedColor} />}
                </Pressable>
            </View>
        </View>
    )
}

function NeutralMessage({ children }: { children: string }) {
    return (
        <Text className="text-center py-6 text-muted-foreground" style={{ fontSize: 13 }}>
            {children}
        </Text>
    )
}

function ActivityContent() {
    return (
        <View className="p-4">
            <NeutralMessage>No recent activity</NeutralMessage>
        </View>
    )
}
