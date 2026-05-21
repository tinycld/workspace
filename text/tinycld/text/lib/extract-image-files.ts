// Pure helper that extracts image File objects from a clipboard paste
// event or a drag-and-drop event. Lives outside the editor hook so it
// can be unit-tested under vitest's node environment without dragging
// the Tiptap/ProseMirror DOM-bound stack into the transform graph.
//
// The handler in use-document-editor.web.tsx returns `true` only when
// at least one image is found — that signals to ProseMirror's paste
// pipeline that we've taken responsibility for the event, so the
// default HTML/plain-text paste path is skipped. When this helper
// returns `[]`, the editor hook returns `false` and the default paste/
// drop flow runs (preserving styled-text pastes from other tabs).

// Loose duck-typed views of ClipboardEvent / DragEvent so the helper
// can be exercised under vitest without polyfilling the full DOM
// interfaces. The real events from the web editor satisfy these
// implicitly.
export interface ClipboardEventLike {
    clipboardData: {
        items?: ArrayLike<DataTransferItemLike> | null
    } | null
}

export interface DragEventLike {
    dataTransfer: {
        files?: ArrayLike<File> | null
    } | null
}

export interface DataTransferItemLike {
    kind: string
    type: string
    getAsFile: () => File | null
}

export function extractImageFilesFromPaste(event: ClipboardEventLike): File[] {
    const items = event.clipboardData?.items
    if (items == null) return []
    const files: File[] = []
    for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item == null) continue
        if (item.kind !== 'file') continue
        if (!item.type.startsWith('image/')) continue
        const file = item.getAsFile()
        if (file != null) files.push(file)
    }
    return files
}

export function extractImageFilesFromDrop(event: DragEventLike): File[] {
    const files = event.dataTransfer?.files
    if (files == null) return []
    const out: File[] = []
    for (let i = 0; i < files.length; i++) {
        const file = files[i]
        if (file == null) continue
        if (!file.type.startsWith('image/')) continue
        out.push(file)
    }
    return out
}
