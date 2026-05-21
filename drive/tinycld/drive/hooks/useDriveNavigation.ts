import type { Href } from 'expo-router'
import { useRouter } from 'expo-router'
import { useDriveUIStore } from '../stores/drive-ui-store'
import type { DriveItemView, SidebarSection } from '../types'

const SECTION_SLUGS: Record<string, SidebarSection> = {
    trash: 'trash',
    starred: 'starred',
    recent: 'recent',
    shared: 'shared-with-me',
}

export function parseDrivePath(pathname: string): { section: SidebarSection; folderId: string } {
    const driveIdx = pathname.indexOf('/drive')
    if (driveIdx === -1) return { section: 'my-drive', folderId: '' }
    const rest = pathname.slice(driveIdx + '/drive'.length)
    const segments = rest.split('/').filter(Boolean)

    if (segments[0] === 'folder' && segments[1]) {
        return { section: 'my-drive', folderId: segments[1] }
    }
    const section = SECTION_SLUGS[segments[0] ?? '']
    if (section) return { section, folderId: '' }
    return { section: 'my-drive', folderId: '' }
}

interface UseDriveNavigationParams {
    orgSlug: string
    activeSection: SidebarSection
    currentFolderId: string
    selectItem: (itemId: string | null) => void
    clearSearch: () => void
    clearSelection: () => void
}

export function useDriveNavigation({
    orgSlug,
    activeSection,
    currentFolderId,
    selectItem,
    clearSearch,
    clearSelection,
}: UseDriveNavigationParams) {
    const router = useRouter()
    const driveBase = `/a/${orgSlug}/drive`

    const buildDriveHref = (opts?: { section?: SidebarSection; folderId?: string }) => {
        if (opts?.folderId) return `${driveBase}/folder/${opts.folderId}` as Href
        if (opts?.section && opts.section !== 'my-drive') {
            const slug = opts.section === 'shared-with-me' ? 'shared' : opts.section
            return `${driveBase}/${slug}` as Href
        }
        return driveBase as Href
    }

    // Preview state lives in the Zustand store, not the URL. Earlier this
    // used router.push to set ?file=X&preview=1, which made Expo Router's
    // <Slot/> remount the screen, blowing away FlashList scroll position
    // every time the modal opened or closed.
    const openPreviewItem = useDriveUIStore((s) => s.openPreviewItem)
    const closePreviewItem = useDriveUIStore((s) => s.closePreviewItem)
    const openPreview = (item: DriveItemView) => {
        if (!item.isFolder) openPreviewItem(item.id)
    }
    const closePreview = () => {
        closePreviewItem()
    }

    const navigateToFolder = (folderId: string) => {
        router.push(buildDriveHref({ folderId: folderId || undefined }))
        clearSearch()
        clearSelection()
    }

    const navigateToSection = (section: SidebarSection) => {
        router.push(buildDriveHref({ section }))
        clearSearch()
        clearSelection()
    }

    const openItem = (item: DriveItemView) => {
        if (item.isFolder) {
            navigateToFolder(item.id)
        } else {
            selectItem(item.id)
        }
    }

    return {
        navigateToFolder,
        navigateToSection,
        openItem,
        openPreview,
        closePreview,
    }
}
