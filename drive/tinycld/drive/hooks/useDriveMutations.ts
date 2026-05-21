import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { pb, useStore } from '@tinycld/core/lib/pocketbase'
import { newRecordId } from 'pbtsdb/core'
import { Platform } from 'react-native'
import type { DriveItemView } from '../types'

interface UseDriveMutationsParams {
    orgId: string
    userOrgId: string
    currentFolderId: string
    stateByItem: Map<string, { id: string; is_starred: boolean; trashed_at: string }>
    itemsById: Map<string, DriveItemView>
    userOrgNames: Map<string, string>
    userOrgEmails: Map<string, string>
    sharesByItem: Map<string, { id: string; item: string; user_org: string; role: string }[]>
    prepareLayoutAnimation?: () => void
}

export function useDriveMutations({
    orgId,
    userOrgId,
    currentFolderId,
    stateByItem,
    itemsById,
    userOrgNames,
    userOrgEmails,
    sharesByItem,
    prepareLayoutAnimation,
}: UseDriveMutationsParams) {
    const [itemsCollection] = useStore('drive_items')
    const [sharesCollection] = useStore('drive_shares')
    const [stateCollection] = useStore('drive_item_state')

    const toggleStarMutation = useMutation({
        mutationFn: mutation(function* ({ itemId, starred }: { itemId: string; starred: boolean }) {
            const existing = stateByItem.get(itemId)
            if (existing) {
                yield stateCollection.update(existing.id, (draft) => {
                    draft.is_starred = !starred
                })
            } else {
                yield stateCollection.insert({
                    id: newRecordId(),
                    item: itemId,
                    user_org: userOrgId,
                    is_starred: true,
                    trashed_at: '',
                    last_viewed_at: '',
                })
            }
        }),
    })

    const trashMutation = useMutation({
        mutationFn: mutation(function* ({ itemId, restore }: { itemId: string; restore: boolean }) {
            const existing = stateByItem.get(itemId)
            if (existing) {
                yield stateCollection.update(existing.id, (draft) => {
                    draft.trashed_at = restore ? '' : new Date().toISOString()
                })
            } else if (!restore) {
                yield stateCollection.insert({
                    id: newRecordId(),
                    item: itemId,
                    user_org: userOrgId,
                    is_starred: false,
                    trashed_at: new Date().toISOString(),
                    last_viewed_at: '',
                })
            }
        }),
    })

    const permanentDeleteMutation = useMutation({
        mutationFn: mutation(function* (itemId: string) {
            const existing = stateByItem.get(itemId)
            if (existing) {
                yield stateCollection.delete(existing.id)
            }
            yield itemsCollection.delete(itemId)
        }),
    })

    const createFolderMutation = useMutation({
        mutationFn: mutation(function* (name: string) {
            yield itemsCollection.insert({
                id: newRecordId(),
                org: orgId,
                name,
                is_folder: true,
                mime_type: '',
                parent: currentFolderId || '',
                created_by: userOrgId,
                size: 0,
                file: '',
                description: '',
            })
        }),
    })

    const renameMutation = useMutation({
        mutationFn: mutation(function* ({ itemId, name }: { itemId: string; name: string }) {
            yield itemsCollection.update(itemId, (draft) => {
                draft.name = name
            })
        }),
    })

    const shareMutation = useMutation({
        mutationFn: mutation(function* ({
            itemId,
            targetUserOrgId,
            role,
        }: {
            itemId: string
            targetUserOrgId: string
            role: 'editor' | 'viewer'
        }) {
            yield sharesCollection.insert({
                id: newRecordId(),
                item: itemId,
                user_org: targetUserOrgId,
                role,
                created_by: userOrgId,
            })
        }),
    })

    const unshareMutation = useMutation({
        mutationFn: mutation(function* (shareId: string) {
            yield sharesCollection.delete(shareId)
        }),
    })

    const moveMutation = useMutation({
        mutationFn: mutation(function* ({ itemId, newParentId }: { itemId: string; newParentId: string }) {
            yield itemsCollection.update(itemId, (draft) => {
                draft.parent = newParentId
            })
        }),
    })

    const toggleStar = (itemId: string) => {
        const item = itemsById.get(itemId)
        toggleStarMutation.mutate({ itemId, starred: item?.starred ?? false })
    }

    const moveToTrash = (itemId: string) => {
        prepareLayoutAnimation?.()
        trashMutation.mutate({ itemId, restore: false })
    }
    const restoreFromTrash = (itemId: string) => {
        prepareLayoutAnimation?.()
        trashMutation.mutate({ itemId, restore: true })
    }
    const permanentlyDelete = (itemId: string) => {
        prepareLayoutAnimation?.()
        permanentDeleteMutation.mutate(itemId)
    }

    const createFolder = (name: string) => createFolderMutation.mutate(name)
    const renameItem = (itemId: string, name: string) => renameMutation.mutate({ itemId, name })

    const shareItem = (itemId: string, targetUserOrgId: string, role: 'editor' | 'viewer') =>
        shareMutation.mutate({ itemId, targetUserOrgId, role })

    const removeShare = (shareId: string) => unshareMutation.mutate(shareId)

    const moveItem = (itemId: string, newParentId: string) => moveMutation.mutate({ itemId, newParentId })

    const restoreToFolder = (itemId: string, newParentId: string) => {
        prepareLayoutAnimation?.()
        moveMutation.mutate({ itemId, newParentId })
        trashMutation.mutate({ itemId, restore: true })
    }

    const canRestoreToOriginalLocation = (itemId: string) => {
        const item = itemsById.get(itemId)
        if (!item) return false
        if (!item.parentId) return true
        const parent = itemsById.get(item.parentId)
        return !!parent && !parent.trashedAt
    }

    const getItemPath = (itemId: string) => {
        const parts: string[] = []
        let id = itemId
        while (id) {
            const item = itemsById.get(id)
            if (!item) break
            parts.unshift(item.name)
            id = item.parentId
        }
        return parts.length > 0 ? `/${parts.join('/')}` : '/My Files'
    }

    const getSharesForItem = (itemId: string) => {
        const shares = sharesByItem.get(itemId) ?? []
        return shares.map((s) => ({
            id: s.id,
            userOrgId: s.user_org,
            name: userOrgNames.get(s.user_org) ?? '',
            email: userOrgEmails.get(s.user_org) ?? '',
            role: s.role,
        }))
    }

    const downloadItem = async (itemId: string) => {
        const item = itemsById.get(itemId)
        if (!item) return
        if (Platform.OS !== 'web') return

        if (item.isFolder) {
            const response = await pb.send('/api/drive/download-token', {
                method: 'POST',
                body: { item: itemId },
            })
            const a = document.createElement('a')
            a.href = `${pb.baseURL}${response.url}`
            a.download = `${item.name}.zip`
            a.click()
        } else {
            if (!item.file) return
            const url = pb.files.getURL({ collectionId: 'drive_items', id: itemId }, item.file)
            const a = document.createElement('a')
            a.href = `${url}?download=1`
            a.download = item.name
            a.click()
        }
    }

    return {
        toggleStar,
        moveToTrash,
        restoreFromTrash,
        permanentlyDelete,
        canRestoreToOriginalLocation,
        restoreToFolder,
        createFolder,
        renameItem,
        downloadItem,
        moveItem,
        shareItem,
        removeShare,
        getSharesForItem,
        getItemPath,
    }
}
