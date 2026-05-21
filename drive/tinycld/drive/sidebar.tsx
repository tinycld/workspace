import { MenuActionItem } from '@tinycld/core/components/DropdownMenu'
import {
    SidebarActionButton,
    SidebarDivider,
    SidebarItem,
    SidebarNav,
} from '@tinycld/core/components/sidebar-primitives'
import { openHelpPackage } from '@tinycld/core/lib/help/open-help'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu } from '@tinycld/core/ui/menu'
import {
    ChevronDown,
    ChevronRight,
    Clock,
    Folder,
    FolderPlus,
    HardDrive,
    HelpCircle,
    Plus,
    Star,
    Trash2,
    Upload,
    UserPlus,
} from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { Platform, Pressable, Text, View } from 'react-native'
import { useDriveState } from './hooks/useDrive'
import type { StorageUsage } from './hooks/useTotalStorage'
import type { FolderTreeNode } from './types'
import { useDriveUIStore } from './stores/drive-ui-store'

interface DriveSidebarProps {
    isCollapsed: boolean
}

export default function DriveSidebar(_props: DriveSidebarProps) {
    const {
        activeSection,
        currentFolderId,
        breadcrumbs,
        navigateToFolder,
        navigateToSection,
        folderTree,
        storageUsage,
        triggerFilePicker,
        openPrompt,
    } = useDriveState()
    const openUploadSheet = useDriveUIStore((s) => s.openUploadSheet)
    const handleUploadPress = Platform.OS === 'web' ? triggerFilePicker : openUploadSheet
    const handleNewFolderPress = () => openPrompt({ type: 'new-folder' })
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

    useEffect(() => {
        if (breadcrumbs.length === 0 && folderTree.length > 0) {
            setExpandedIds((prev) => {
                if (prev.size > 0) return prev
                return new Set(folderTree.map((n) => n.item.id))
            })
        }
        if (breadcrumbs.length > 0) {
            const ancestorIds = breadcrumbs.map((b) => b.id)
            setExpandedIds((prev) => {
                const next = new Set(prev)
                for (const id of ancestorIds) next.add(id)
                return next
            })
        }
    }, [breadcrumbs, folderTree])

    const toggleExpand = (id: string) => {
        setExpandedIds((prev) => {
            const next = new Set(prev)
            if (next.has(id)) {
                next.delete(id)
            } else {
                next.add(id)
            }
            return next
        })
    }

    const handleFolderPress = (id: string) => {
        navigateToFolder(id)
        setExpandedIds((prev) => {
            const next = new Set(prev)
            next.add(id)
            return next
        })
    }

    return (
        <SidebarNav>
            <Menu>
                <Menu.Trigger>
                    <SidebarActionButton label="New" icon={Plus} />
                </Menu.Trigger>
                <Menu.Portal>
                    <Menu.Overlay />
                    <Menu.Content presentation="popover" placement="bottom" align="start">
                        <MenuActionItem label="Upload" icon={Upload} onPress={handleUploadPress} />
                        <MenuActionItem label="New folder" icon={FolderPlus} onPress={handleNewFolderPress} />
                    </Menu.Content>
                </Menu.Portal>
            </Menu>

            <SidebarItem
                label="My Files"
                icon={HardDrive}
                isActive={activeSection === 'my-drive' && currentFolderId === ''}
                closesDrawer
                onPress={() => navigateToSection('my-drive')}
            />

            <FolderTree
                nodes={folderTree}
                expandedIds={expandedIds}
                selectedFolderId={currentFolderId}
                onToggle={toggleExpand}
                onSelect={handleFolderPress}
                depth={1}
            />

            <SidebarDivider />

            <SidebarItem
                label="Shared with me"
                icon={UserPlus}
                isActive={activeSection === 'shared-with-me'}
                closesDrawer
                onPress={() => navigateToSection('shared-with-me')}
            />
            <SidebarItem
                label="Recent"
                icon={Clock}
                isActive={activeSection === 'recent'}
                closesDrawer
                onPress={() => navigateToSection('recent')}
            />
            <SidebarItem
                label="Starred"
                icon={Star}
                isActive={activeSection === 'starred'}
                closesDrawer
                onPress={() => navigateToSection('starred')}
            />

            <SidebarDivider />

            <SidebarItem
                label="Trash"
                icon={Trash2}
                isActive={activeSection === 'trash'}
                closesDrawer
                onPress={() => navigateToSection('trash')}
            />

            <SidebarDivider />

            <SidebarItem
                label="Help"
                icon={HelpCircle}
                closesDrawer
                onPress={() => openHelpPackage('drive')}
            />

            <StorageBar storageUsage={storageUsage} />
        </SidebarNav>
    )
}

interface FolderTreeProps {
    nodes: FolderTreeNode[]
    expandedIds: Set<string>
    selectedFolderId: string
    onToggle: (id: string) => void
    onSelect: (id: string) => void
    depth: number
}

function FolderTree({ nodes, expandedIds, selectedFolderId, onToggle, onSelect, depth }: FolderTreeProps) {
    if (nodes.length === 0) return null

    return (
        <View>
            {nodes.map((node) => (
                <FolderTreeItem
                    key={node.item.id}
                    node={node}
                    expandedIds={expandedIds}
                    selectedFolderId={selectedFolderId}
                    onToggle={onToggle}
                    onSelect={onSelect}
                    depth={depth}
                />
            ))}
        </View>
    )
}

interface FolderTreeItemProps {
    node: FolderTreeNode
    expandedIds: Set<string>
    selectedFolderId: string
    onToggle: (id: string) => void
    onSelect: (id: string) => void
    depth: number
}

function FolderTreeItem({ node, expandedIds, selectedFolderId, onToggle, onSelect, depth }: FolderTreeItemProps) {
    const mutedColor = useThemeColor('muted-foreground')
    const fgColor = useThemeColor('foreground')
    const activeIndicator = useThemeColor('active-indicator')
    const isExpanded = expandedIds.has(node.item.id)
    const isSelected = selectedFolderId === node.item.id
    const hasChildren = node.children.length > 0
    const ChevronIcon = isExpanded ? ChevronDown : ChevronRight

    return (
        <View key={node.item.id}>
            <Pressable
                className="flex-row items-center rounded-lg pr-3"
                style={{
                    gap: 6,
                    paddingVertical: 6,
                    paddingLeft: depth * 16,
                    ...(isSelected ? { backgroundColor: `${activeIndicator}18` } : {}),
                }}
                onPress={() => onSelect(node.item.id)}
            >
                {hasChildren ? (
                    <Pressable
                        onPress={() => onToggle(node.item.id)}
                        className="items-center justify-center"
                        style={{ width: 18 }}
                    >
                        <ChevronIcon size={14} color={mutedColor} />
                    </Pressable>
                ) : (
                    <View className="items-center justify-center" style={{ width: 18 }} />
                )}
                <Folder size={16} color={isSelected ? activeIndicator : mutedColor} />
                <Text
                    numberOfLines={1}
                    className="flex-1"
                    style={{
                        fontSize: 12,
                        color: isSelected ? activeIndicator : fgColor,
                        fontWeight: isSelected ? '600' : undefined,
                    }}
                >
                    {node.item.name}
                </Text>
            </Pressable>
            {isExpanded && node.children.length > 0 && (
                <FolderTree
                    nodes={node.children}
                    expandedIds={expandedIds}
                    selectedFolderId={selectedFolderId}
                    onToggle={onToggle}
                    onSelect={onSelect}
                    depth={depth + 1}
                />
            )}
        </View>
    )
}

function StorageBar({ storageUsage }: { storageUsage: StorageUsage }) {
    const { usedBytes, limitBytes, hasLimit } = storageUsage
    const usedGB = usedBytes / 1024 ** 3

    if (!hasLimit || limitBytes <= 0) {
        return (
            <View className="px-3 py-2" style={{ gap: 6 }}>
                <Text className="text-muted-foreground" style={{ fontSize: 11 }}>
                    {usedGB.toFixed(2)} GB used
                </Text>
            </View>
        )
    }

    const totalGB = limitBytes / 1024 ** 3
    const percentage = Math.min(100, (usedBytes / limitBytes) * 100)

    return (
        <View className="px-3 py-2" style={{ gap: 6 }}>
            <View className="overflow-hidden rounded-sm bg-muted-foreground/10" style={{ height: 4 }}>
                <View className="h-full rounded-sm bg-primary" style={{ width: `${percentage}%` }} />
            </View>
            <Text className="text-muted-foreground" style={{ fontSize: 11 }}>
                {usedGB.toFixed(2)} GB of {totalGB.toFixed(0)} GB used
            </Text>
        </View>
    )
}
