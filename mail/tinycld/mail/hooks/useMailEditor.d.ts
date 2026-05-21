import type { EditorHandle, EditorResult } from '@tinycld/core/lib/editor/types'

interface UseMailEditorOptions {
    initialContent?: string
    placeholder?: string
    autofocus?: boolean
}

export declare function useMailEditor(options?: UseMailEditorOptions): EditorResult

export declare function setContentWhenReady(editor: EditorHandle, content: string): () => void
