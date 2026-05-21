export interface DataTransferLike {
    files?: FileList | null
    dropEffect?: string
}

export function extractDroppedFiles(dt: DataTransferLike | null | undefined): File[] {
    if (!dt?.files || dt.files.length === 0) return []
    return Array.from(dt.files as FileList)
}

interface ControllerOptions {
    onChange: (isDragging: boolean) => void
    onFiles: (files: File[]) => void
    isEnabled: boolean
}

export interface FileDropController {
    enter: () => void
    leave: () => void
    drop: (files: File[]) => void
    isDragging: () => boolean
    reset: () => void
}

export function createFileDropController(opts: ControllerOptions): FileDropController {
    let counter = 0
    let dragging = false

    const setDragging = (next: boolean) => {
        if (dragging === next) return
        dragging = next
        opts.onChange(next)
    }

    return {
        enter: () => {
            counter += 1
            if (counter > 0) setDragging(true)
        },
        leave: () => {
            if (counter > 0) counter -= 1
            if (counter <= 0) {
                counter = 0
                setDragging(false)
            }
        },
        drop: (files: File[]) => {
            counter = 0
            setDragging(false)
            if (!opts.isEnabled) return
            if (files.length === 0) return
            opts.onFiles(files)
        },
        isDragging: () => dragging,
        reset: () => {
            counter = 0
            setDragging(false)
        },
    }
}
