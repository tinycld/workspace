import { useCurrentUserOrg } from '@tinycld/core/lib/use-current-user-org'
import { useOrgInfo } from '@tinycld/core/lib/use-org-info'
import { useUserPreference } from '@tinycld/core/lib/use-user-preference'
import { router, useLocalSearchParams, usePathname } from 'expo-router'
import {
    type MutableRefObject,
    type ReactNode,
    createContext,
    useCallback,
    useContext,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react'
import { notifyDriveSnapshotListeners, writeDriveSnapshot } from '../stores/drive-snapshot-store'
import type { DialogTarget, PromptDialog } from '../stores/drive-ui-store'
import { useDriveUIStore } from '../stores/drive-ui-store'
import type { DriveItemView, SidebarSection, ViewMode } from '../types'
import { useDriveItems } from './useDriveItems'
import { useDriveMutations } from './useDriveMutations'
import { parseDrivePath, useDriveNavigation } from './useDriveNavigation'
import { useDriveSearch } from './useDriveSearch'
import { useFileUpload } from './useFileUpload'
import { useTotalStorage } from './useTotalStorage'

// Subset of drive callbacks that rows + the context menu need. The
// returned bundle is referentially stable for the lifetime of
// DriveStateProvider — each function calls through a ref to the latest
// impl, so consumers can read these once (via cellContext or the snapshot
// store) and avoid re-rendering on every drive-state tick. New action
// fields go here when a row needs them; anything not on this surface
// still goes through useDrive() / useDriveSnapshot() and re-renders on
// drive-state changes.
export interface DriveActions {
    openPreview: (item: DriveItemView) => void
    openItem: (item: DriveItemView) => void
    navigateToFolder: (folderId: string) => void
    toggleStar: (itemId: string) => void
    downloadItem: (itemId: string) => void
    moveToTrash: (itemId: string) => void
    selectItem: (id: string | null) => void
    openDetailPanel: () => void
    dismissUpload: (id: string) => void
}

export interface DriveContextValue {
    currentFolderId: string
    activeSection: SidebarSection
    selectedItemId: string | null
    selectedIds: Set<string>
    clearSelection: () => void
    viewMode: ViewMode
    currentItems: DriveItemView[]
    breadcrumbs: DriveItemView[]
    selectedItem: DriveItemView | undefined
    folderTree: import('../types').FolderTreeNode[]
    storageUsage: import('./useTotalStorage').StorageUsage
    isLoading: boolean
    searchQuery: string
    setSearchQuery: (query: string) => void
    isSearching: boolean
    previewItem: DriveItemView | null
    openPreview: (item: DriveItemView) => void
    closePreview: () => void
    detailPanelOpen: boolean
    toggleDetailPanel: () => void
    openDetailPanel: () => void
    closeDetailPanel: () => void
    navigateToFolder: (folderId: string) => void
    navigateToSection: (section: SidebarSection) => void
    selectItem: (itemId: string | null) => void
    setViewMode: (mode: ViewMode) => void
    openItem: (item: DriveItemView) => void
    toggleStar: (itemId: string) => void
    moveToTrash: (itemId: string) => void
    restoreFromTrash: (itemId: string) => void
    permanentlyDelete: (itemId: string) => void
    canRestoreToOriginalLocation: (itemId: string) => boolean
    restoreToFolder: (itemId: string, newParentId: string) => void
    createFolder: (name: string) => void
    renameItem: (itemId: string, name: string) => void
    downloadItem: (itemId: string) => void
    moveItem: (itemId: string, newParentId: string) => void
    shareItem: (itemId: string, userOrgId: string, role: 'editor' | 'viewer') => void
    removeShare: (shareId: string) => void
    getSharesForItem: (itemId: string) => { id: string; userOrgId: string; name: string; email: string; role: string }[]
    orgMembers: { userOrgId: string; name: string; email: string }[]
    /** itemsById feeds useUploadPlaceholders so completed uploads stop
     *  rendering as placeholders once the real record arrives. */
    itemsById: Map<string, DriveItemView>
    /** Current user_org id; needed by useUploadPlaceholders to stamp the
     *  owner field on optimistic upload rows. */
    userOrgId: string
    // Upload action handles are stable (constructed once and held by ref).
    // Reactive upload progress is NOT exposed here on purpose — that lives
    // in useUploadStore so progress ticks don't churn DriveContextValue.
    uploadFiles: (files: File[]) => void
    uploadTree: (entries: import('./useFileUpload').DroppedEntry[]) => void
    triggerFilePicker: () => void
    triggerPhotoPicker: () => void
    uploadNewVersion: (itemId: string, file: File) => Promise<void>
    getItemPath: (itemId: string) => string
    promptDialog: PromptDialog
    promptKey: number
    openPrompt: (state: PromptDialog) => void
    closePrompt: () => void
    handlePromptSubmit: (value: string) => void
    moveTarget: DialogTarget | null
    openMoveDialog: (id: string, name: string) => void
    closeMoveDialog: () => void
    shareTarget: DialogTarget | null
    openShareDialog: (id: string, name: string) => void
    closeShareDialog: () => void
    /** Stable callable bundle for hot paths (rows, lazy-mounted menu). */
    actions: DriveActions
}

// useDriveState() runs the entire drive data tree (live queries, mutations,
// upload, navigation, search, total storage). Calling it once per row +
// per context-menu wrapper meant ~120 redundant copies on a 60-item list,
// which is most of the cost of switching between list and grid view.
//
// DriveStateProvider computes useDriveState() once at the screen layout
// level; useDrive() reads from the context. The sidebar mounts in the
// workspace shell above the drive routes — it has no provider, so it
// calls useDriveState() directly.
const DriveStateContext = createContext<DriveContextValue | null>(null)

// The screen owns the FlashList ref; mutations live in useDriveState which
// runs above the screen. This ref shuttles a "prep layout animation"
// callback bottom-up: the screen sets it on mount, the trash/restore
// mutations call it before .mutate() so FlashList can disable recycling
// for the next frame and run a slide animation.
const LayoutAnimationContext = createContext<MutableRefObject<(() => void) | undefined> | null>(null)

export function DriveStateProvider({ children }: { children: ReactNode }) {
    const layoutAnimationRef = useRef<(() => void) | undefined>(undefined)
    const value = useDriveState({ layoutAnimationRef })
    // Mirror the latest value into an external store so portaled subtrees
    // (Menu.Portal goes through Gluestack's OverlayContainer, which severs
    // the React context chain) can read drive state via useDriveSnapshot.
    //
    // Write during render so subscribers that mount/read after this point
    // see fresh data via getSnapshot(); flush change notifications in a
    // layout effect so React doesn't see a setState() coming from this
    // component during render of any other component.
    writeDriveSnapshot(value)
    useLayoutEffect(() => {
        notifyDriveSnapshotListeners()
    })
    return (
        <LayoutAnimationContext.Provider value={layoutAnimationRef}>
            <DriveStateContext.Provider value={value}>{children}</DriveStateContext.Provider>
        </LayoutAnimationContext.Provider>
    )
}

export function useDrive(): DriveContextValue {
    const ctx = useContext(DriveStateContext)
    if (!ctx) {
        throw new Error('useDrive() must be called within a <DriveStateProvider>')
    }
    return ctx
}

// Screens call this on mount to register a callback that gets invoked
// before reorder-y mutations (trash/restore/delete). The callback should
// call FlashList.prepareForLayoutAnimationRender() and
// LayoutAnimation.configureNext(). Returns a cleanup that clears the slot.
export function useRegisterDriveLayoutAnimation(prepare: (() => void) | undefined): void {
    const ref = useContext(LayoutAnimationContext)
    useEffect(() => {
        if (!ref) return
        ref.current = prepare
        return () => {
            if (ref.current === prepare) ref.current = undefined
        }
    }, [ref, prepare])
}

interface UseDriveStateOptions {
    layoutAnimationRef?: MutableRefObject<(() => void) | undefined>
}

// Builds a referentially-stable DriveActions bundle. Each returned
// function calls through a ref to the latest impl, so it can close over
// freshly-rendered closures (mutations, navigation, upload) without
// changing identity. Rows can read from cellContext.actions and skip
// useDrive() entirely; the menu can read from the snapshot store and not
// rebuild its handlers per drive-state tick.
function useStableDriveActions(latest: DriveActions): DriveActions {
    const ref = useRef(latest)
    ref.current = latest
    return useMemo<DriveActions>(
        () => ({
            openPreview: (item) => ref.current.openPreview(item),
            openItem: (item) => ref.current.openItem(item),
            navigateToFolder: (folderId) => ref.current.navigateToFolder(folderId),
            toggleStar: (itemId) => ref.current.toggleStar(itemId),
            downloadItem: (itemId) => ref.current.downloadItem(itemId),
            moveToTrash: (itemId) => ref.current.moveToTrash(itemId),
            selectItem: (id) => ref.current.selectItem(id),
            openDetailPanel: () => ref.current.openDetailPanel(),
            dismissUpload: (id) => ref.current.dismissUpload(id),
        }),
        []
    )
}

export function useDriveState(options: UseDriveStateOptions = {}): DriveContextValue {
    const { layoutAnimationRef } = options
    const prepareLayoutAnimation = useMemo(
        () =>
            layoutAnimationRef
                ? () => layoutAnimationRef.current?.()
                : undefined,
        [layoutAnimationRef]
    )
    const { orgSlug, orgId } = useOrgInfo()
    const userOrg = useCurrentUserOrg(orgSlug)
    const userOrgId = userOrg?.id ?? ''

    const pathname = usePathname()
    const { section: activeSection, folderId: currentFolderId } = parseDrivePath(pathname)

    // Preview state is store-only — see useDriveNavigation for why. URL
    // sharing is handled separately: hydrate-on-mount from ?file=X&preview=1
    // and mirror store -> URL via history.replaceState (no router push, so
    // <Slot/> never remounts and FlashList scroll is preserved).
    const selectedItemId = useDriveUIStore((s) => s.selectedItemId)
    const selectItem = useDriveUIStore((s) => s.selectItem)
    const selectedIds = useDriveUIStore((s) => s.selectedIds)
    const clearSelection = useDriveUIStore((s) => s.clearSelection)
    const previewItemId = useDriveUIStore((s) => s.previewItemId)
    usePreviewUrlSync(previewItemId)

    // viewMode is decoupled from server persistence so the toggle UI updates
    // synchronously. useUserPreference goes through a TanStack DB optimistic
    // mutation + live-query notify cycle that costs ~100ms — perceptible on
    // every click. Local React state flips instantly; the persisted value
    // hydrates the local state once (on first sync) and writes through on
    // every change in the background.
    //
    // Once the user has toggled locally, ignore further server-driven
    // updates. Otherwise rapid clicks can race the in-flight persistence:
    // if click N+1 lands before click N's write echoes back through the
    // live query, the echo would overwrite the newer local state.
    const [persistedViewMode, persistViewMode] = useUserPreference<ViewMode>('drive', 'view_mode', 'list')
    const [viewMode, setViewModeLocal] = useState<ViewMode>(persistedViewMode)
    const localOverrideRef = useRef(false)
    useEffect(() => {
        if (localOverrideRef.current) return
        setViewModeLocal(persistedViewMode)
    }, [persistedViewMode])
    const setViewMode = useCallback(
        (mode: ViewMode) => {
            localOverrideRef.current = true
            setViewModeLocal(mode)
            persistViewMode(mode)
        },
        [persistViewMode]
    )

    const {
        searchQuery,
        setSearchQuery,
        promptDialog,
        promptKey,
        openPrompt,
        closePrompt,
        moveTarget,
        openMoveDialog: openMoveDialogStore,
        closeMoveDialog,
        shareTarget,
        openShareDialog: openShareDialogStore,
        closeShareDialog,
        detailPanelOpen,
        toggleDetailPanel,
        openDetailPanel,
        closeDetailPanel,
    } = useDriveUIStore()

    const isSearchActive = searchQuery.length >= 2
    const { results: searchResults, isSearching } = useDriveSearch(isSearchActive ? searchQuery : '', orgId)

    const upload = useFileUpload({
        orgId,
        userOrgId,
        currentFolderId,
    })

    const items = useDriveItems({
        userOrgId,
        activeSection,
        currentFolderId,
        selectedItemId,
        previewItemId,
        searchQuery,
        searchResults,
        isSearchActive,
    })

    const storageUsage = useTotalStorage()

    const mutations = useDriveMutations({
        orgId,
        userOrgId,
        currentFolderId,
        stateByItem: items.stateByItem,
        itemsById: items.itemsById,
        userOrgNames: items.userOrgNames,
        userOrgEmails: items.userOrgEmails,
        sharesByItem: items.sharesByItem,
        prepareLayoutAnimation,
    })

    const nav = useDriveNavigation({
        orgSlug,
        activeSection,
        currentFolderId,
        selectItem,
        clearSearch: () => setSearchQuery(''),
        clearSelection,
    })

    const openMoveDialog = (id: string, name: string) => {
        selectItem(id)
        openMoveDialogStore(id, name)
    }

    const openShareDialog = (id: string, name: string) => {
        selectItem(id)
        openShareDialogStore(id, name)
    }

    const handlePromptSubmit = (value: string) => {
        if (promptDialog.type === 'new-folder') {
            mutations.createFolder(value)
        } else if (promptDialog.type === 'rename') {
            mutations.renameItem(promptDialog.itemId, value)
        }
        closePrompt()
    }

    const actions = useStableDriveActions({
        openPreview: nav.openPreview,
        openItem: nav.openItem,
        navigateToFolder: nav.navigateToFolder,
        toggleStar: mutations.toggleStar,
        downloadItem: mutations.downloadItem,
        moveToTrash: mutations.moveToTrash,
        selectItem,
        openDetailPanel,
        dismissUpload: upload.dismissUpload,
    })

    return {
        currentFolderId,
        activeSection,
        selectedItemId,
        selectedIds,
        clearSelection,
        viewMode,
        currentItems: items.currentItems,
        breadcrumbs: items.breadcrumbs,
        selectedItem: items.selectedItem,
        folderTree: items.folderTree,
        storageUsage,
        isLoading: items.isLoading,
        searchQuery,
        setSearchQuery,
        isSearching,
        previewItem: items.previewItem,
        openPreview: nav.openPreview,
        closePreview: nav.closePreview,
        detailPanelOpen,
        toggleDetailPanel,
        openDetailPanel,
        closeDetailPanel,
        navigateToFolder: nav.navigateToFolder,
        navigateToSection: nav.navigateToSection,
        selectItem,
        setViewMode,
        openItem: nav.openItem,
        toggleStar: mutations.toggleStar,
        moveToTrash: mutations.moveToTrash,
        restoreFromTrash: mutations.restoreFromTrash,
        permanentlyDelete: mutations.permanentlyDelete,
        canRestoreToOriginalLocation: mutations.canRestoreToOriginalLocation,
        restoreToFolder: mutations.restoreToFolder,
        createFolder: mutations.createFolder,
        renameItem: mutations.renameItem,
        downloadItem: mutations.downloadItem,
        moveItem: mutations.moveItem,
        shareItem: mutations.shareItem,
        removeShare: mutations.removeShare,
        getSharesForItem: mutations.getSharesForItem,
        orgMembers: items.orgMembers,
        itemsById: items.itemsById,
        userOrgId,
        uploadFiles: upload.uploadFiles,
        uploadTree: upload.uploadTree,
        triggerFilePicker: upload.triggerFilePicker,
        triggerPhotoPicker: upload.triggerPhotoPicker,
        uploadNewVersion: upload.uploadNewVersion,
        getItemPath: mutations.getItemPath,
        promptDialog,
        promptKey,
        openPrompt,
        closePrompt,
        handlePromptSubmit,
        moveTarget,
        openMoveDialog,
        closeMoveDialog,
        shareTarget,
        openShareDialog,
        closeShareDialog,
        actions,
    }
}

// Bridge between the preview store flag and the browser URL.
//
// Two flows:
//   1. On mount, if the URL has ?file=X&preview=1, seed the store so a
//      shared link opens the modal. Runs once.
//   2. While the user navigates between previews via the modal's prev/next
//      controls (or opens/closes), mirror the store value back to the URL
//      via router.setParams — a shallow params update that doesn't remount
//      the route (so <Slot/> stays put) and works on native (where the
//      URL bar is invisible but the navigation state still tracks).
function usePreviewUrlSync(previewItemId: string | null): void {
    const openPreviewItem = useDriveUIStore((s) => s.openPreviewItem)
    const params = useLocalSearchParams<{ file?: string; preview?: string }>()

    // Hydrate once from the initial URL params.
    const hydratedRef = useRef(false)
    useEffect(() => {
        if (hydratedRef.current) return
        hydratedRef.current = true
        if (params.preview === '1' && params.file) {
            openPreviewItem(params.file)
        }
    }, [openPreviewItem, params.file, params.preview])

    // Mirror store -> URL params. Only writes when the value actually
    // differs to avoid a setParams loop with the hydrator above.
    useEffect(() => {
        const desiredFile = previewItemId ?? undefined
        const desiredPreview = previewItemId ? '1' : undefined
        if (params.file === desiredFile && params.preview === desiredPreview) return
        router.setParams({ file: desiredFile, preview: desiredPreview })
    }, [previewItemId, params.file, params.preview])
}
