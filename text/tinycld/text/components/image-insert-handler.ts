import type {
    CreateDriveItemInput,
    CreateDriveItemResult,
    UploadBody,
} from '@tinycld/drive/lib/upload-to-drive'

// Shape returned by the platform picker. Carries enough to drive a
// drive_items create: an UploadBody the FormData encoder accepts plus
// the originating name + mime type. Returning null = user cancelled.
export interface PickedImage {
    body: UploadBody
    name: string
    mimeType: string
}

interface UploadMutateOptions {
    onSuccess: (result: CreateDriveItemResult) => void
    onError: (err: unknown) => void
}

export type UploadMutate = (input: CreateDriveItemInput, options: UploadMutateOptions) => void

interface HandleImageInsertDeps {
    pickImage: () => Promise<PickedImage | null>
    upload: UploadMutate
    // Builds the file URL the editor inserts. Receives the STORED file
    // name (result.file), not the user-visible name — PB serves files at
    // /api/files/<col>/<id>/<storedFile>. Async because drive_items is a
    // protected collection, so the URL needs a short-lived ?token=, which
    // requires a network round-trip to fetch.
    buildURL: (collectionId: string, itemId: string, storedFile: string) => Promise<string>
    captureException: (tag: string, err: unknown) => void
}

// Orchestrates picker → drive upload → onInsert(url). Lives in its own
// non-component module so vitest can import it under node-env without
// pulling react-native through the transform graph. Mirrors the
// paste/drop path in use-document-editor.web.tsx — both routes funnel
// the bytes through useCreateDriveItem and insert the resulting
// PocketBase file URL, never a data: URI.
export async function handleImageInsert(
    onInsert: (url: string) => void,
    deps: HandleImageInsertDeps
): Promise<void> {
    let picked: PickedImage | null
    try {
        picked = await deps.pickImage()
    } catch (err) {
        deps.captureException('text.toolbarImageUpload', err)
        return
    }
    if (picked == null) return
    deps.upload(
        {
            body: picked.body,
            name: picked.name,
            mimeType: picked.mimeType,
        },
        {
            onSuccess: (result) => {
                deps.buildURL('drive_items', result.itemId, result.file)
                    .then(onInsert)
                    .catch((err) => deps.captureException('text.toolbarImageUpload', err))
            },
            onError: (err) => deps.captureException('text.toolbarImageUpload', err),
        }
    )
}
