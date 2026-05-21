import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Platform } from 'react-native'
import { createFileDropController, extractDroppedFiles } from './fileDropController'

interface UseFileDropOptions {
    onFiles: (files: File[]) => void
    isEnabled: boolean
}

type RNViewRef = unknown

/**
 * Web-only drop-target hook for accepting files dragged from the OS.
 *
 * Returns a ref callback to attach to the drop-target React Native View. We attach
 * native DOM `dragenter` / `dragover` / `dragleave` / `drop` listeners imperatively
 * because react-native-web's <View> does not forward these events as props to the
 * underlying <div>. On native, the ref callback is a no-op and `isDragging` stays false.
 *
 * Known gap: some browsers don't always fire a final `dragleave` when the user drags
 * out of the window entirely (over browser chrome or another app). The overlay can
 * "stick" until the next drag activity. Listening for `drop` resets reliably; the
 * stuck-overlay case clears on the next dragenter.
 */
export function useFileDrop({ onFiles, isEnabled }: UseFileDropOptions): {
    isDragging: boolean
    dropRef: (node: RNViewRef) => void
} {
    const [isDragging, setIsDragging] = useState(false)
    const onFilesRef = useRef(onFiles)
    onFilesRef.current = onFiles
    const isEnabledRef = useRef(isEnabled)
    isEnabledRef.current = isEnabled
    const attachedNodeRef = useRef<HTMLElement | null>(null)

    const controller = useMemo(
        () =>
            createFileDropController({
                onChange: setIsDragging,
                onFiles: (files) => onFilesRef.current(files),
                isEnabled: true,
            }),
        []
    )

    useEffect(() => {
        return () => {
            const el = attachedNodeRef.current
            if (el) {
                detachDropListeners(el)
                attachedNodeRef.current = null
            }
        }
    }, [])

    const dropRef = useCallback(
        (node: RNViewRef) => {
            if (Platform.OS !== 'web') return
            const el = isHtmlElement(node) ? node : null
            const previous = attachedNodeRef.current
            if (previous === el) return
            if (previous) detachDropListeners(previous)
            attachedNodeRef.current = el
            if (!el) return
            attachDropListeners(el, {
                onEnter: () => controller.enter(),
                onOver: (e) => {
                    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
                },
                onLeave: () => controller.leave(),
                onDrop: (e) => {
                    const files = extractDroppedFiles(e.dataTransfer)
                    if (!isEnabledRef.current) {
                        controller.reset()
                        return
                    }
                    controller.drop(files)
                },
            })
        },
        [controller]
    )

    return { isDragging, dropRef }
}

function isHtmlElement(node: unknown): node is HTMLElement {
    return (
        typeof node === 'object' &&
        node !== null &&
        typeof (node as HTMLElement).addEventListener === 'function' &&
        typeof (node as HTMLElement).removeEventListener === 'function'
    )
}

interface DropHandlers {
    onEnter: (e: DragEvent) => void
    onOver: (e: DragEvent) => void
    onLeave: (e: DragEvent) => void
    onDrop: (e: DragEvent) => void
}

const HANDLERS_KEY = '__tinycldDropHandlers__'

interface ElementWithHandlers extends HTMLElement {
    [HANDLERS_KEY]?: {
        enter: (e: DragEvent) => void
        over: (e: DragEvent) => void
        leave: (e: DragEvent) => void
        drop: (e: DragEvent) => void
    }
}

function attachDropListeners(el: HTMLElement, h: DropHandlers) {
    const wrapped = {
        enter: (e: DragEvent) => {
            e.preventDefault()
            h.onEnter(e)
        },
        over: (e: DragEvent) => {
            e.preventDefault()
            h.onOver(e)
        },
        leave: (e: DragEvent) => {
            e.preventDefault()
            h.onLeave(e)
        },
        drop: (e: DragEvent) => {
            e.preventDefault()
            h.onDrop(e)
        },
    }
    ;(el as ElementWithHandlers)[HANDLERS_KEY] = wrapped
    el.addEventListener('dragenter', wrapped.enter)
    el.addEventListener('dragover', wrapped.over)
    el.addEventListener('dragleave', wrapped.leave)
    el.addEventListener('drop', wrapped.drop)
}

function detachDropListeners(el: HTMLElement) {
    const wrapped = (el as ElementWithHandlers)[HANDLERS_KEY]
    if (!wrapped) return
    el.removeEventListener('dragenter', wrapped.enter)
    el.removeEventListener('dragover', wrapped.over)
    el.removeEventListener('dragleave', wrapped.leave)
    el.removeEventListener('drop', wrapped.drop)
    delete (el as ElementWithHandlers)[HANDLERS_KEY]
}
