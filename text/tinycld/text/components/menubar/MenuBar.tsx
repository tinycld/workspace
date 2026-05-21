import type { EditorCommands, EditorToolbarState } from '@tinycld/core/lib/editor/types'
import { MenuBar as CoreMenuBar } from '@tinycld/core/ui/menubar'
import type { Editor as TiptapEditor } from '@tiptap/react'
import type { DocumentFileActions } from '../../hooks/use-document-file-actions'
import { EditMenu } from './EditMenu'
import { FileMenu } from './FileMenu'
import { FormatMenu } from './FormatMenu'
import { HelpMenu } from './HelpMenu'
import { InsertMenu } from './InsertMenu'

export interface MenuBarProps {
    documentName: string
    documentId: string
    sourceFile: string
    commands: EditorCommands
    toolbarState: EditorToolbarState
    fileActions: DocumentFileActions
    disabled: boolean
    onPrint: () => void
    onRequestInsertLink: () => void
    onInsertImage: (url: string) => void
    // Live Tiptap handle. Threaded through for menu actions that need
    // to read the current PM JSON (Download .md) or insert content
    // directly (Paste as Markdown). Null on native, where the host
    // doesn't own the editor.
    tiptapEditor: TiptapEditor | null
}

export function MenuBar(props: MenuBarProps) {
    return (
        <CoreMenuBar>
            <FileMenu {...props} />
            <EditMenu {...props} />
            <InsertMenu {...props} />
            <FormatMenu {...props} />
            <HelpMenu {...props} />
        </CoreMenuBar>
    )
}
