import type { EditorCommands, EditorHandle, EditorResult, EditorToolbarState } from '@tinycld/core/lib/editor/types'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import Placeholder from '@tiptap/extension-placeholder'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useMemo } from 'react'
import { View } from 'react-native'
import '../styles/editor.css'

interface UseMailEditorOptions {
    initialContent?: string
    placeholder?: string
    autofocus?: boolean
}

export function useMailEditor(options: UseMailEditorOptions = {}): EditorResult {
    const placeholderColor = useThemeColor('field-placeholder')
    const primaryColor = useThemeColor('primary')

    const tiptapEditor = useEditor({
        extensions: [
            StarterKit.configure({ link: { openOnClick: false } }),
            Placeholder.configure({ placeholder: options.placeholder ?? '' }),
        ],
        content: options.initialContent ?? '',
    })

    const editor: EditorHandle = useMemo(
        () => ({
            getHTML: () => Promise.resolve(tiptapEditor?.getHTML() ?? ''),
            getText: () => Promise.resolve(tiptapEditor?.getText() ?? ''),
            setContent: (html: string) => tiptapEditor?.commands.setContent(html),
            focus: (position?: 'start' | 'end') => {
                if (position === 'start') {
                    tiptapEditor?.chain().focus('start').run()
                } else {
                    tiptapEditor?.chain().focus('end').run()
                }
            },
            clear: () => tiptapEditor?.commands.clearContent(),
            getSelection: () => {
                const selection = tiptapEditor?.state.selection
                if (!selection) return Promise.resolve(null)
                return Promise.resolve({ from: selection.from, to: selection.to })
            },
        }),
        [tiptapEditor]
    )

    const commands: EditorCommands = useMemo(
        () => ({
            toggleBold: () => tiptapEditor?.chain().focus().toggleBold().run(),
            toggleItalic: () => tiptapEditor?.chain().focus().toggleItalic().run(),
            toggleUnderline: () => tiptapEditor?.chain().focus().toggleUnderline().run(),
            toggleBulletList: () => tiptapEditor?.chain().focus().toggleBulletList().run(),
            toggleOrderedList: () => tiptapEditor?.chain().focus().toggleOrderedList().run(),
            toggleBlockquote: () => tiptapEditor?.chain().focus().toggleBlockquote().run(),
            toggleHeading: (level: number) =>
                tiptapEditor
                    ?.chain()
                    .focus()
                    .toggleHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 })
                    .run(),
            setLink: (url: string) => tiptapEditor?.chain().focus().setLink({ href: url }).run(),
            removeLink: () => tiptapEditor?.chain().focus().unsetLink().run(),
            undo: () => tiptapEditor?.chain().focus().undo().run(),
            redo: () => tiptapEditor?.chain().focus().redo().run(),
        }),
        [tiptapEditor]
    )

    const toolbarState: EditorToolbarState = {
        isBoldActive: tiptapEditor?.isActive('bold') ?? false,
        isItalicActive: tiptapEditor?.isActive('italic') ?? false,
        isUnderlineActive: tiptapEditor?.isActive('underline') ?? false,
        isBulletListActive: tiptapEditor?.isActive('bulletList') ?? false,
        isOrderedListActive: tiptapEditor?.isActive('orderedList') ?? false,
        isBlockquoteActive: tiptapEditor?.isActive('blockquote') ?? false,
        isLinkActive: tiptapEditor?.isActive('link') ?? false,
        currentLink: (tiptapEditor?.getAttributes('link')?.href as string) ?? null,
    }

    const EditorComponent = useMemo(
        () =>
            function MailEditorContent() {
                return (
                    <View
                        className="flex-1 min-h-[100px] tinycld-mail-editor"
                        style={{
                            // @ts-expect-error CSS custom properties for web
                            '--editor-placeholder-color': placeholderColor,
                            '--editor-primary-color': primaryColor,
                        }}
                    >
                        <EditorContent editor={tiptapEditor} />
                    </View>
                )
            },
        [tiptapEditor, placeholderColor, primaryColor]
    )

    return { editor, EditorComponent, commands, toolbarState }
}

export function setContentWhenReady(editor: EditorHandle, content: string): () => void {
    editor.setContent(content)
    return () => {}
}
