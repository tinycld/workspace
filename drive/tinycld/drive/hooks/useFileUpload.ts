import { usePickFiles } from '@tinycld/core/file-viewer/use-pick-files'
import { captureException } from '@tinycld/core/lib/errors'
import { performMutations, useMutation } from '@tinycld/core/lib/mutations'
import { pb, useStore } from '@tinycld/core/lib/pocketbase'
import { newRecordId } from 'pbtsdb/core'
import { useCallback, useRef } from 'react'
import { Platform } from 'react-native'
import { type UploadingFile, useUploadStore } from '../stores/upload-store'

export type { UploadingFile, UploadStatus } from '../stores/upload-store'

export interface DroppedEntry {
    path: string
    file: File | null // null = directory
}

interface UseFileUploadOptions {
    orgId: string
    userOrgId: string
    currentFolderId: string
}

const DONE_AUTO_CLEAR_MS = 3000
const PROGRESS_THROTTLE_MS = 60

// Direct XHR upload — used instead of pb.collection().create() because we need
// xhr.upload.onprogress events to drive the per-file progress bar. PocketBase's
// SDK uses fetch() under the hood, which doesn't expose upload progress.
// React Native's XMLHttpRequest polyfill supports upload progress as well, so
// the same code path works on web and native.
function uploadFormDataWithProgress(params: {
    url: string
    formData: FormData
    authToken: string
    onProgress: (loaded: number, total: number) => void
}): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', params.url, true)
        if (params.authToken) {
            xhr.setRequestHeader('Authorization', params.authToken)
        }
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) params.onProgress(e.loaded, e.total)
        }
        xhr.onload = () => {
            const text = typeof xhr.response === 'string' ? xhr.response : xhr.responseText
            let parsed: unknown = null
            try {
                parsed = text ? JSON.parse(text) : null
            } catch {
                // Non-JSON response — treat as empty success body.
                parsed = null
            }
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(parsed)
            } else {
                const message =
                    parsed && typeof parsed === 'object' && 'message' in parsed && typeof parsed.message === 'string'
                        ? parsed.message
                        : `Upload failed (${xhr.status})`
                reject(new Error(message))
            }
        }
        xhr.onerror = () => reject(new TypeError('Network request failed'))
        xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'))
        xhr.send(params.formData)
    })
}

export function useFileUpload({ orgId, userOrgId, currentFolderId }: UseFileUploadOptions) {
    // Intentionally NOT subscribing to uploadingFiles here. useFileUpload runs
    // inside useDriveState, so any reactive read of upload progress would force
    // every useDrive() consumer (toolbar, dialogs, layout, sidebar) to re-render
    // on every progress tick (~60ms throttle). Components that need to display
    // upload state read useUploadStore directly; the mutation pipeline below
    // writes via getState().
    const folderRef = useRef(currentFolderId)
    folderRef.current = currentFolderId
    const [itemsCollection] = useStore('drive_items')
    const { pickFiles } = usePickFiles()

    const updateFile = useCallback((id: string, patch: Partial<UploadingFile>) => {
        useUploadStore.getState().update(id, patch)
    }, [])

    const dismissUpload = useCallback((id: string) => {
        useUploadStore.getState().remove(id)
    }, [])

    const scheduleClearDone = useCallback((id: string) => {
        setTimeout(() => {
            useUploadStore.getState().clearDoneById(id)
        }, DONE_AUTO_CLEAR_MS)
    }, [])

    // Throttled progress writer: at most one update per ~60ms per file, plus a
    // final flush when bytes reach total so the bar always lands on 100%.
    const makeProgressHandler = useCallback(
        (id: string) => {
            let lastUpdate = 0
            return (loaded: number, total: number) => {
                const now = Date.now()
                const isFinal = total > 0 && loaded >= total
                if (!isFinal && now - lastUpdate < PROGRESS_THROTTLE_MS) return
                lastUpdate = now
                updateFile(id, total > 0 ? { loaded, size: total } : { loaded })
            }
        },
        [updateFile]
    )

    const uploadOne = useCallback(
        async (params: {
            id: string
            name: string
            parentId: string
            file: File
        }) => {
            const { id, name, parentId, file } = params
            updateFile(id, { status: 'uploading', loaded: 0 })

            const formData = new FormData()
            formData.append('id', id)
            formData.append('org', orgId)
            formData.append('name', name)
            formData.append('is_folder', 'false')
            formData.append('mime_type', file.type || 'application/octet-stream')
            formData.append('parent', parentId)
            formData.append('created_by', userOrgId)
            formData.append('size', String(file.size))
            formData.append('file', file)
            formData.append('description', '')

            const response = await uploadFormDataWithProgress({
                url: pb.buildURL('/api/collections/drive_items/records'),
                formData,
                authToken: pb.authStore.token ?? '',
                onProgress: makeProgressHandler(id),
            })

            const finalName =
                response && typeof response === 'object' && 'name' in response && typeof response.name === 'string'
                    ? response.name
                    : name
            updateFile(id, { status: 'done', loaded: file.size, name: finalName })
            scheduleClearDone(id)
        },
        [orgId, userOrgId, makeProgressHandler, updateFile, scheduleClearDone]
    )

    const uploadMutation = useMutation({
        mutationFn: async (files: File[]) => {
            const parentId = folderRef.current
            const queued: UploadingFile[] = files.map((f) => ({
                id: newRecordId(),
                name: f.name,
                parentId,
                size: f.size,
                loaded: 0,
                status: 'pending',
            }))
            useUploadStore.getState().add(queued)

            for (let i = 0; i < files.length; i++) {
                const file = files[i]
                const entry = queued[i]
                try {
                    await uploadOne({ id: entry.id, name: entry.name, parentId, file })
                } catch (err) {
                    const message = err instanceof Error ? err.message : 'Upload failed'
                    updateFile(entry.id, { status: 'error', errorMessage: message })
                    captureException('useFileUpload', err)
                    throw err
                }
            }
        },
    })

    const uploadFiles = useCallback(
        (files: File[]) => {
            if (files.length === 0) return
            uploadMutation.mutate(files)
        },
        [uploadMutation]
    )

    const triggerFilePicker = useCallback(async () => {
        const picked = await pickFiles({ sources: ['documents'], multiple: true })
        if (picked.length > 0) uploadFiles(picked.map((p) => p.file))
    }, [pickFiles, uploadFiles])

    const triggerPhotoPicker = useCallback(async () => {
        if (Platform.OS === 'web') return
        const picked = await pickFiles({ sources: ['photoLibrary'], multiple: true })
        if (picked.length > 0) uploadFiles(picked.map((p) => p.file))
    }, [pickFiles, uploadFiles])

    const uploadTreeMutation = useMutation({
        mutationFn: async (entries: DroppedEntry[]) => {
            const parentId = folderRef.current
            const fileEntries = entries.filter((e) => e.file)
            const queued: UploadingFile[] = fileEntries.map((e) => ({
                id: newRecordId(),
                name: e.path,
                parentId,
                size: e.file?.size ?? 0,
                loaded: 0,
                status: 'pending',
            }))
            useUploadStore.getState().add(queued)
            const queuedById = new Map(fileEntries.map((e, i) => [e.path, queued[i]]))

            // Map directory path -> PocketBase record ID
            const folderIds = new Map<string, string>()

            // Sort entries so directories come before their children
            const sorted = [...entries].sort((a, b) => {
                const aDepth = a.path.split('/').length
                const bDepth = b.path.split('/').length
                if (aDepth !== bDepth) return aDepth - bDepth
                return a.path.localeCompare(b.path)
            })

            for (const entry of sorted) {
                const segments = entry.path.split('/')
                const name = segments[segments.length - 1]
                const parentPath = segments.slice(0, -1).join('/')
                const localParentId = parentPath ? (folderIds.get(parentPath) ?? '') : parentId

                if (!entry.file) {
                    const folderId = newRecordId()
                    folderIds.set(entry.path, folderId)

                    await performMutations(function* () {
                        yield itemsCollection.insert({
                            id: folderId,
                            org: orgId,
                            name,
                            is_folder: true,
                            mime_type: '',
                            parent: localParentId,
                            created_by: userOrgId,
                            size: 0,
                            file: '',
                            description: '',
                        })
                    })
                } else {
                    const queuedEntry = queuedById.get(entry.path)
                    if (!queuedEntry) continue

                    try {
                        await uploadOne({
                            id: queuedEntry.id,
                            name,
                            parentId: localParentId,
                            file: entry.file,
                        })
                    } catch (err) {
                        const message = err instanceof Error ? err.message : 'Upload failed'
                        updateFile(queuedEntry.id, { status: 'error', errorMessage: message })
                        captureException('useFileUpload.uploadTree', err)
                        throw err
                    }
                }
            }
        },
    })

    const uploadTree = useCallback(
        (entries: DroppedEntry[]) => {
            if (entries.length === 0) return
            uploadTreeMutation.mutate(entries)
        },
        [uploadTreeMutation]
    )

    const uploadNewVersion = useCallback(async (itemId: string, file: File) => {
        const formData = new FormData()
        formData.append('item', itemId)
        formData.append('file', file)
        await pb.send('/api/drive/upload-version', {
            method: 'POST',
            body: formData,
        })
    }, [])

    return {
        uploadFiles,
        uploadTree,
        dismissUpload,
        triggerFilePicker,
        triggerPhotoPicker,
        uploadNewVersion,
    }
}
