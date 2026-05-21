import { and, eq, inArray } from '@tanstack/db'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { useMemo } from 'react'
import { mimeTypeToCategory } from '../components/file-icons'
import type { DriveItemView, FolderTreeNode, SidebarSection } from '../types'
import type { DriveSearchResult } from './useDriveSearch'

interface UseDriveItemsParams {
    userOrgId: string
    activeSection: SidebarSection
    currentFolderId: string
    selectedItemId: string | null
    previewItemId: string | null
    searchQuery: string
    searchResults: DriveSearchResult[]
    isSearchActive: boolean
}

/**
 * Loads the drive_items needed for the current view via on-demand server-side
 * filters, then assembles them into the shapes the UI consumes (currentItems,
 * folderTree, breadcrumbs, etc.).
 *
 * The drive_items collection runs in syncMode:'on-demand' — each useLiveQuery
 * here translates its where/orderBy into a PocketBase filter, so we never
 * load the whole org's items just to show one folder.
 *
 *   - `currentFolderQuery`  — the items shown in the main pane.
 *   - `foldersQuery`        — every folder the user can see; small and stable;
 *                             drives the sidebar tree, breadcrumbs, and the
 *                             folder section above the file list.
 *   - `sectionQuery`        — only fires for non-my-drive sections.
 *   - `selectedItemQuery`   — fires when a selection / preview id isn't in
 *                             any of the above subsets (e.g. shared link).
 *
 * drive_shares and drive_item_state stay eager: small, used everywhere, cheap.
 */
export function useDriveItems({
    userOrgId,
    activeSection,
    currentFolderId,
    selectedItemId,
    previewItemId,
    searchResults,
    isSearchActive,
}: UseDriveItemsParams) {
    const [itemsCollection] = useStore('drive_items')
    const [sharesCollection] = useStore('drive_shares')
    const [stateCollection] = useStore('drive_item_state')
    const [userOrgCollection] = useStore('user_org')

    // --- supporting eager collections (small) ---------------------------------

    const { data: rawShares, isLoading: sharesLoading } = useOrgLiveQuery((query) =>
        query.from({ share: sharesCollection })
    )

    const { data: rawStates, isLoading: statesLoading } = useOrgLiveQuery((query, { userOrgId: scopedUserOrgId }) =>
        query.from({ state: stateCollection }).where(({ state }) => eq(state.user_org, scopedUserOrgId))
    )

    const { data: orgUserOrgs, isLoading: userOrgsLoading } = useOrgLiveQuery((query, { orgId: scopedOrgId }) =>
        query.from({ uo: userOrgCollection }).where(({ uo }) => eq(uo.org, scopedOrgId))
    )

    const userOrgNames = useMemo(
        () => new Map((orgUserOrgs ?? []).map((uo) => [uo.id, uo.expand?.user?.name || uo.expand?.user?.email || ''])),
        [orgUserOrgs]
    )

    const orgMembers = useMemo(
        () =>
            (orgUserOrgs ?? [])
                .filter((uo) => uo.id !== userOrgId)
                .map((uo) => ({
                    userOrgId: uo.id,
                    name: uo.expand?.user?.name || '',
                    email: uo.expand?.user?.email || '',
                })),
        [orgUserOrgs, userOrgId]
    )

    const userOrgEmails = useMemo(
        () => new Map((orgUserOrgs ?? []).map((uo) => [uo.id, uo.expand?.user?.email || ''])),
        [orgUserOrgs]
    )

    const sharesByItem = useMemo(() => {
        const map = new Map<string, NonNullable<typeof rawShares>>()
        for (const share of rawShares ?? []) {
            const list = map.get(share.item) ?? []
            list.push(share)
            map.set(share.item, list)
        }
        return map
    }, [rawShares])

    const stateByItem = useMemo(() => new Map((rawStates ?? []).map((s) => [s.item, s])), [rawStates])

    // --- on-demand drive_items queries ----------------------------------------
    // Each useOrgLiveQuery against drive_items is translated to a PocketBase
    // filter and run server-side. Disabled queries return empty data.

    // Items in the current folder for the current org. Only meaningful when the
    // user is inside My Drive (or a subfolder); other sections supply their own
    // listing via sectionQuery below.
    const showCurrentFolder = !isSearchActive && activeSection === 'my-drive'
    const { data: rawCurrentFolderItems, isLoading: currentFolderLoading } = useOrgLiveQuery(
        (query, { orgId: scopedOrgId }) => {
            if (!showCurrentFolder) return null
            return query
                .from({ item: itemsCollection })
                .where(({ item }) => and(eq(item.org, scopedOrgId), eq(item.parent, currentFolderId)))
        },
        [showCurrentFolder, currentFolderId]
    )

    // Every folder the user can see in this org. Small set (folders are a tiny
    // fraction of items), drives the sidebar tree, breadcrumb resolution, and
    // the folder section above the file list.
    const { data: rawFolders, isLoading: foldersLoading } = useOrgLiveQuery((query, { orgId: scopedOrgId }) =>
        query.from({ item: itemsCollection }).where(({ item }) => and(eq(item.org, scopedOrgId), eq(item.is_folder, true)))
    )

    // Section-specific listings — only fired for sections other than my-drive,
    // which has its own currentFolderQuery.
    const isStarredSection = activeSection === 'starred'
    const isTrashSection = activeSection === 'trash'
    const isRecentSection = activeSection === 'recent'
    const isSharedSection = activeSection === 'shared-with-me'
    const sectionScoped = !isSearchActive && (isStarredSection || isTrashSection || isRecentSection || isSharedSection)

    // Collect the set of item ids that should appear in the active id-driven
    // section (starred/trash via drive_item_state, shared-with-me via the user's
    // non-owner drive_shares rows). Avoids ne/not in the server filter — pbtsdb's
    // converter emits `!(...)`, which PocketBase's filter parser doesn't accept.
    const idDrivenSectionIds = useMemo(() => {
        if (isStarredSection) {
            return (rawStates ?? [])
                .filter((s) => s.is_starred && !s.trashed_at)
                .map((s) => s.item)
        }
        if (isTrashSection) {
            return (rawStates ?? []).filter((s) => !!s.trashed_at).map((s) => s.item)
        }
        if (isSharedSection) {
            return (rawShares ?? [])
                .filter((s) => s.user_org === userOrgId && s.role !== 'owner')
                .map((s) => s.item)
        }
        return null
    }, [isStarredSection, isTrashSection, isSharedSection, rawStates, rawShares, userOrgId])

    const { data: rawSectionItems, isLoading: sectionLoading } = useOrgLiveQuery(
        (query, { orgId: scopedOrgId }) => {
            if (!sectionScoped) return null
            const base = query.from({ item: itemsCollection })
            if (isRecentSection) {
                return base
                    .where(({ item }) => and(eq(item.org, scopedOrgId), eq(item.is_folder, false)))
                    .orderBy(({ item }) => item.updated, 'desc')
                    .limit(20)
            }
            // starred / trash / shared-with-me are id-driven via the membership
            // rows we already have locally. If the user has no rows in this set,
            // skip the fetch entirely.
            if (!idDrivenSectionIds || idDrivenSectionIds.length === 0) return null
            return base.where(({ item }) => and(eq(item.org, scopedOrgId), inArray(item.id, idDrivenSectionIds)))
        },
        [sectionScoped, isRecentSection, idDrivenSectionIds]
    )

    // Selected/preview lookup. If the URL-driven id isn't in any of the loaded
    // subsets, fetch it directly so the preview / selection still resolves.
    const wantedLookupId = previewItemId ?? selectedItemId ?? null
    const lookupAlreadyLoaded = useMemo(() => {
        if (!wantedLookupId) return true
        const matches = (rows: { id: string }[] | undefined) =>
            !!rows && rows.some((it) => it.id === wantedLookupId)
        return matches(rawCurrentFolderItems) || matches(rawFolders) || matches(rawSectionItems)
    }, [wantedLookupId, rawCurrentFolderItems, rawFolders, rawSectionItems])

    const lookupNeeded = !!wantedLookupId && !lookupAlreadyLoaded
    const { data: rawLookupItems } = useOrgLiveQuery(
        (query, { orgId: scopedOrgId }) => {
            if (!lookupNeeded || !wantedLookupId) return null
            return query
                .from({ item: itemsCollection })
                .where(({ item }) => and(eq(item.org, scopedOrgId), eq(item.id, wantedLookupId)))
        },
        [lookupNeeded, wantedLookupId]
    )

    // --- merging + view shapes ------------------------------------------------

    // Union of every drive_item we currently have loaded, deduplicated by id.
    // Downstream code can keep using one map regardless of which query supplied
    // each row.
    const loadedItems = useMemo(() => {
        type Item = NonNullable<typeof rawFolders>[number]
        const merged = new Map<string, Item>()
        const sources = [rawCurrentFolderItems, rawFolders, rawSectionItems, rawLookupItems]
        for (const src of sources) {
            if (!src) continue
            for (const row of src) merged.set(row.id, row)
        }
        return [...merged.values()]
    }, [rawCurrentFolderItems, rawFolders, rawSectionItems, rawLookupItems])

    const allItems = useMemo<DriveItemView[]>(
        () =>
            loadedItems.map((item) => {
                const state = stateByItem.get(item.id)
                const shares = sharesByItem.get(item.id) ?? []
                const hasNonOwnerShares = shares.some((s) => s.role !== 'owner')
                const ownerName = userOrgNames.get(item.created_by) ?? ''

                return {
                    id: item.id,
                    name: item.name,
                    isFolder: item.is_folder,
                    mimeType: item.mime_type,
                    parentId: item.parent ?? '',
                    owner: item.created_by === userOrgId ? 'me' : ownerName,
                    ownerUserOrgId: item.created_by,
                    updated: item.updated,
                    size: item.size,
                    shared: hasNonOwnerShares,
                    starred: state?.is_starred ?? false,
                    trashedAt: state?.trashed_at ?? '',
                    file: item.file,
                    thumbnail: (item as unknown as { thumbnail?: string }).thumbnail ?? '',
                    description: item.description,
                    category: mimeTypeToCategory(item.mime_type, item.is_folder),
                }
            }),
        [loadedItems, stateByItem, sharesByItem, userOrgId, userOrgNames]
    )

    const itemsById = useMemo(() => new Map(allItems.map((i) => [i.id, i])), [allItems])

    const searchItemViews = useMemo<DriveItemView[]>(() => {
        if (!isSearchActive) return []
        return searchResults.map((sr) => {
            const existing = itemsById.get(sr.id)
            if (existing) return existing
            return {
                id: sr.id,
                name: sr.name,
                isFolder: sr.is_folder,
                mimeType: sr.mime_type,
                parentId: '',
                owner: '',
                ownerUserOrgId: '',
                updated: '',
                size: sr.size,
                shared: false,
                starred: false,
                trashedAt: '',
                file: '',
                thumbnail: '',
                description: sr.description,
                category: mimeTypeToCategory(sr.mime_type, sr.is_folder),
            }
        })
    }, [isSearchActive, searchResults, itemsById])

    const currentFolderItems = useMemo<DriveItemView[]>(() => {
        if (!showCurrentFolder) return []
        const ids = new Set((rawCurrentFolderItems ?? []).map((i) => i.id))
        return allItems.filter((i) => ids.has(i.id) && !i.trashedAt)
    }, [showCurrentFolder, rawCurrentFolderItems, allItems])

    const sectionItems = useMemo<DriveItemView[]>(() => {
        if (!sectionScoped) return []
        const ids = new Set((rawSectionItems ?? []).map((i) => i.id))
        const filtered = allItems.filter((i) => ids.has(i.id))
        // section-level filters that aren't expressible in PB filter syntax,
        // or that depend on local drive_item_state we already have.
        if (isStarredSection) return filtered.filter((i) => i.starred && !i.trashedAt)
        if (isTrashSection) return filtered.filter((i) => !!i.trashedAt)
        if (isRecentSection) return filtered.filter((i) => !i.trashedAt)
        if (isSharedSection) return filtered.filter((i) => !i.trashedAt)
        return filtered
    }, [sectionScoped, rawSectionItems, allItems, isStarredSection, isTrashSection, isRecentSection, isSharedSection])

    // currentItems intentionally excludes upload placeholders. The screen
    // composes those in via useUploadPlaceholders so that progress ticks
    // don't churn DriveContextValue.
    const currentItems = useMemo(() => {
        if (isSearchActive) return searchItemViews
        if (showCurrentFolder) return currentFolderItems
        return sectionItems
    }, [isSearchActive, searchItemViews, showCurrentFolder, currentFolderItems, sectionItems])

    const breadcrumbs = useMemo(() => {
        const crumbs: DriveItemView[] = []
        let id = currentFolderId
        while (id) {
            const item = itemsById.get(id)
            if (!item) break
            crumbs.unshift(item)
            id = item.parentId
        }
        return crumbs
    }, [currentFolderId, itemsById])

    const selectedItem = useMemo(
        () => (selectedItemId ? itemsById.get(selectedItemId) : undefined),
        [selectedItemId, itemsById]
    )

    const previewItem = useMemo(
        () => (previewItemId ? (itemsById.get(previewItemId) ?? null) : null),
        [previewItemId, itemsById]
    )

    const folderTree = useMemo(() => {
        const folders = allItems.filter((i) => i.isFolder && i.ownerUserOrgId === userOrgId && !i.trashedAt)

        function buildTree(parentId: string): FolderTreeNode[] {
            return folders
                .filter((f) => f.parentId === parentId)
                .map((folder) => ({
                    item: folder,
                    children: buildTree(folder.id),
                }))
        }

        return buildTree('')
    }, [allItems, userOrgId])

    const isLoading =
        currentFolderLoading || foldersLoading || sectionLoading || sharesLoading || statesLoading || userOrgsLoading

    return {
        itemsById,
        currentItems,
        breadcrumbs,
        selectedItem,
        previewItem,
        folderTree,
        isLoading,
        orgMembers,
        stateByItem,
        sharesByItem,
        userOrgNames,
        userOrgEmails,
    }
}

