import { captureException } from '@tinycld/core/lib/errors'
import { pb } from '@tinycld/core/lib/pocketbase'
import { useCreateDriveItem } from '@tinycld/drive/lib/upload-to-drive'
import type { ComponentType } from 'react'
import { useCallback } from 'react'
import { Platform, Pressable } from 'react-native'
import { handleImageInsert, type PickedImage } from './image-insert-handler'
import { ToolbarTooltip } from './ToolbarTooltip'

interface ImageInsertButtonProps {
    icon: ComponentType<{ size: number; color: string }>
    iconColor: string
    disabled?: boolean
    onInsert: (url: string) => void
}

export function ImageInsertButton({
    icon: Icon,
    iconColor,
    disabled = false,
    onInsert,
}: ImageInsertButtonProps) {
    const handlePress = useImageInsert(onInsert)

    return (
        <ToolbarTooltip label="Insert image">
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Insert image"
                accessibilityState={{ disabled }}
                disabled={disabled}
                onPress={handlePress}
                className="rounded-md p-1.5"
                style={disabled ? { opacity: 0.4 } : undefined}
                hitSlop={
                    Platform.OS === 'web' ? undefined : { top: 6, bottom: 6, left: 4, right: 4 }
                }
            >
                <Icon size={16} color={iconColor} />
            </Pressable>
        </ToolbarTooltip>
    )
}

// Shared by ImageInsertButton (toolbar) and InsertMenu (menubar).
// Wires the platform picker → useCreateDriveItem → pb.files.getURL
// chain so both insertion surfaces match the paste/drop path: every
// inserted image is a stable PocketBase file URL, not a base64 data:
// URI that bloats every Y.Doc update.
export function useImageInsert(onInsert: (url: string) => void): () => void {
    const createDriveItem = useCreateDriveItem()
    return useCallback(() => {
        void handleImageInsert(onInsert, {
            pickImage,
            upload: createDriveItem.mutate,
            buildURL: buildInsertedImageURL,
            captureException,
        })
    }, [onInsert, createDriveItem.mutate])
}

// Builds the URL the editor STORES in the document for an inserted image.
// Deliberately tokenless and built from the STORED file name (not the
// user-visible `name`, which PB suffixes): the src is persisted into the
// Y.Doc and round-tripped through docx, so it must be stable and
// shareable across users — a per-user, ~2-minute file token baked in
// here would expire and leak one user's token to everyone. The protected
// collection still needs a token to actually fetch the bytes; that's
// appended fresh at render time by ImageNodeView (web) via
// withFileToken(), and on the server the flush resolves the bytes
// directly off the drive_items record. Shared by the toolbar/menubar
// path and the paste/drop path.
export function buildInsertedImageURL(
    collectionId: string,
    itemId: string,
    storedFile: string
): Promise<string> {
    return Promise.resolve(pb.files.getURL({ collectionId, id: itemId }, storedFile))
}

export async function pickImage(): Promise<PickedImage | null> {
    if (Platform.OS === 'web') {
        return pickImageWeb()
    }
    return pickImageNative()
}

function pickImageWeb(): Promise<PickedImage | null> {
    if (typeof document === 'undefined') return Promise.resolve(null)
    return new Promise(resolve => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'image/png,image/jpeg,image/gif,image/webp'
        let settled = false
        const settle = (value: PickedImage | null) => {
            if (settled) return
            settled = true
            resolve(value)
        }
        input.onchange = () => {
            const file = input.files?.[0]
            if (file == null) return settle(null)
            settle({
                body: file,
                name: file.name || 'image.png',
                mimeType: file.type || 'image/png',
            })
        }
        input.addEventListener('cancel', () => settle(null))
        input.click()
    })
}

async function pickImageNative(): Promise<PickedImage | null> {
    const picker = await import('expo-document-picker')
    const result = await picker.getDocumentAsync({
        type: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
        copyToCacheDirectory: true,
    })
    if (result.canceled) return null
    const asset = result.assets?.[0]
    if (asset == null) return null
    const mimeType = asset.mimeType ?? 'image/png'
    const name = asset.name ?? 'image.png'
    // RN's FormData polyfill accepts a `{ uri, name, type }` literal for
    // file fields, which is exactly what useCreateDriveItem expects on
    // native. No base64 round-trip required — the platform's URI points
    // at the file the picker copied into the app's cache directory.
    return {
        body: { uri: asset.uri, name, type: mimeType },
        name,
        mimeType,
    }
}
