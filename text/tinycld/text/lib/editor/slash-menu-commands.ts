import type { Editor, Range } from '@tiptap/core'
import type { SlashMenuIconName } from './slash-menu-icon-lookup'
// Side-effect type imports: load the module augmentations these
// extensions ship in their .d.ts so editor.chain().toggleHeading /
// toggleBulletList / toggleOrderedList / toggleBlockquote /
// toggleCodeBlock / insertTable / setHorizontalRule resolve on the
// ChainedCommands surface used in the run() handlers below. The
// runtime extensions are registered through StarterKit + Table in
// Editor.tsx and use-document-editor.web.tsx; these imports exist
// only to make TypeScript see the `declare module '@tiptap/core'`
// augmentations.
import '@tiptap/extension-heading'
import '@tiptap/extension-bullet-list'
import '@tiptap/extension-ordered-list'
import '@tiptap/extension-blockquote'
import '@tiptap/extension-code-block'
import '@tiptap/extension-table'
import '@tiptap/extension-horizontal-rule'

// NOTE: do NOT import lucide-react-native at the top of this file.
// SLASH_MENU_COMMANDS is consumed by the WebView's editor bundle
// (Editor.tsx → SlashMenu extension → SLASH_MENU_COMMANDS) and a
// lucide-react-native import would drag react-native into the
// WebView bundle (the build script's esbuild can't transform RN
// Flow syntax). Icon resolution happens at the host: web's
// SlashMenu.web.tsx and the native SlashMenuPopover both look the
// iconName up via slash-menu-icon-lookup.ts.

// Argument signature for image-insert handlers. The flow is delegated
// to the screen — the slash menu only fires `openImageInsert()`, which
// in turn opens the existing file/URL picker, then routes the resulting
// src back through `commands.insertImage`. Inlining the picker in the
// suggestion plugin would entangle it with the screen-level mutations,
// so we keep it as a callback the host wires in.
export interface SlashMenuCommandContext {
    editor: Editor
    range: Range
    openImageInsert?: () => void
}

export interface SlashMenuCommand {
    id: string
    label: string
    // Search keywords beyond the label. The filter matches against
    // both `label` and `keywords` so users can type "h1" → Heading 1
    // without the label needing to advertise the shorthand.
    keywords: string[]
    // String identifier mapped to a LucideIcon component at the host
    // layer (web's SlashMenu.web.tsx and the native SlashMenuPopover
    // both call resolveSlashMenuIcon(iconName)). Storing only the
    // string here keeps this module — and the WebView bundle that
    // consumes SLASH_MENU_COMMANDS — free of lucide-react-native,
    // which transitively pulls in react-native and breaks esbuild.
    //
    // Typed as `keyof typeof SLASH_MENU_ICONS` (the lookup table in
    // slash-menu-icon-lookup.ts) so a typo here fails typecheck.
    iconName: SlashMenuIconName
    run: (ctx: SlashMenuCommandContext) => void
}

// Block-insertion commands surfaced by the slash menu. Order here is
// the order shown in the popover when the query is empty. New v1
// entries should be appended unless there's a UX reason to insert
// them mid-list.
export const SLASH_MENU_COMMANDS: SlashMenuCommand[] = [
    {
        id: 'heading-1',
        label: 'Heading 1',
        keywords: ['h1', 'title', 'header'],
        iconName: 'Heading1',
        run: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).toggleHeading({ level: 1 }).run()
        },
    },
    {
        id: 'heading-2',
        label: 'Heading 2',
        keywords: ['h2', 'subtitle', 'header'],
        iconName: 'Heading2',
        run: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).toggleHeading({ level: 2 }).run()
        },
    },
    {
        id: 'heading-3',
        label: 'Heading 3',
        keywords: ['h3', 'subheader', 'header'],
        iconName: 'Heading3',
        run: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).toggleHeading({ level: 3 }).run()
        },
    },
    {
        id: 'bullet-list',
        label: 'Bullet list',
        keywords: ['ul', 'unordered', 'list'],
        iconName: 'List',
        run: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).toggleBulletList().run()
        },
    },
    {
        id: 'numbered-list',
        label: 'Numbered list',
        keywords: ['ol', 'ordered', 'numbered', 'list'],
        iconName: 'ListOrdered',
        run: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).toggleOrderedList().run()
        },
    },
    {
        id: 'quote',
        label: 'Quote',
        keywords: ['blockquote', 'citation'],
        iconName: 'Quote',
        run: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).toggleBlockquote().run()
        },
    },
    {
        id: 'code-block',
        label: 'Code block',
        keywords: ['code', 'codeblock', 'snippet', 'pre'],
        iconName: 'Code2',
        run: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).toggleCodeBlock().run()
        },
    },
    {
        id: 'table',
        label: 'Table',
        keywords: ['grid', 'rows', 'columns'],
        iconName: 'Table',
        run: ({ editor, range }) => {
            editor
                .chain()
                .focus()
                .deleteRange(range)
                .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                .run()
        },
    },
    {
        id: 'image',
        label: 'Image',
        keywords: ['picture', 'photo', 'img'],
        iconName: 'Image',
        // Image picking happens outside the editor (file picker, URL
        // prompt, drive upload). We delete the slash trigger here and
        // delegate to the host-supplied `openImageInsert` callback so
        // the screen can run its existing image-insert flow.
        run: ({ editor, range, openImageInsert }) => {
            editor.chain().focus().deleteRange(range).run()
            openImageInsert?.()
        },
    },
    {
        id: 'horizontal-rule',
        label: 'Horizontal rule',
        keywords: ['hr', 'divider', 'separator', 'line'],
        iconName: 'Minus',
        run: ({ editor, range }) => {
            editor.chain().focus().deleteRange(range).setHorizontalRule().run()
        },
    },
]

// Case-insensitive substring filter over label + keywords. Empty /
// whitespace-only queries return the full list in stable order so the
// menu shows the canonical entry order the moment the user types `/`.
export function filterSlashMenuCommands(
    query: string,
    commands: SlashMenuCommand[] = SLASH_MENU_COMMANDS
): SlashMenuCommand[] {
    const q = query.trim().toLowerCase()
    if (!q) return commands.slice()
    return commands.filter(cmd => {
        if (cmd.label.toLowerCase().includes(q)) return true
        return cmd.keywords.some(kw => kw.toLowerCase().includes(q))
    })
}
