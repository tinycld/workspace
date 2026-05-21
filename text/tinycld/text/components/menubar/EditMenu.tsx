import { captureException } from '@tinycld/core/lib/errors'
import { Menu, MenuBarMenu, MenuShortcut, Separator } from '@tinycld/core/ui/menubar'
import { useFindReplaceStore } from '../../lib/stores/find-replace-store'
import type { MenuBarProps } from './MenuBar'

// Stable reference — Zustand selectors don't subscribe when consumers
// only read getState(), and the menu item's onPress fires imperatively.
const openFindReplace = () => useFindReplaceStore.getState().open()

export function EditMenu(props: MenuBarProps) {
    const { commands, toolbarState, disabled, tiptapEditor } = props
    const selectionEmpty = toolbarState.selectionEmpty ?? true
    const editDisabled = disabled || selectionEmpty

    // Reads plain text from the system clipboard and inserts it as
    // structured PM content. Async because navigator.clipboard.readText
    // returns a Promise; the menu handler is fire-and-forget.
    //
    // Salvage strategy: each top-level markdown block is inserted in
    // its own chain.run(). If a block's parsed PM tree fails the
    // schema (mark exclusivity, disallowed content, ...) we fall back
    // to inserting the *original markdown source* for that block as a
    // plain paragraph — the rest of the paste survives, and the user
    // sees the failing chunk verbatim so they can hand-fix it. If
    // every per-block insert fails (catastrophe, e.g. an editor that
    // doesn't accept paragraphs either), we drop the entire markdown
    // source as a single paragraph so the user still gets something.
    //
    // The chain explicitly seeks the cursor to end-of-doc before each
    // insert. On a brand-new collaborative doc the user has often
    // never clicked into the editor, so the selection is still the
    // default <0, 0> at position 0, which is *outside* every block —
    // insertContent at that position silently rejects every block-level
    // node. After each insert we re-read docSize so the next block
    // lands after the one we just inserted, in order.
    // Paste-as-Markdown is web-only (it leans on navigator.clipboard +
    // markdown-it). Dynamic-importing the markdown modules inside the
    // handler keeps them off the native bundle's module-init path —
    // markdown-it ships ESM .mjs files that crash on Hermes when
    // evaluated at startup. The handler is also a no-op on native
    // because there's no editor handle there.
    const pasteAsMarkdown = () => {
        if (!tiptapEditor) return
        if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) return
        navigator.clipboard
            .readText()
            .then(async text => {
                if (!text) return
                const [{ markdownToPMBlocks }, { insertBlocksSequentially, insertPlaintext }] =
                    await Promise.all([
                        import('../../lib/markdown/md-to-pm'),
                        import('./paste-as-markdown'),
                    ])
                const blocks = markdownToPMBlocks(text)
                if (blocks.length === 0) {
                    insertPlaintext(tiptapEditor, text)
                    return
                }
                const { succeeded, salvaged } = insertBlocksSequentially(tiptapEditor, blocks)
                if (succeeded === 0 && salvaged === 0) {
                    // Nothing landed at all — the editor refused both the
                    // parsed PM *and* a plain paragraph fallback. Last-ditch:
                    // drop the entire markdown source as a single paragraph.
                    insertPlaintext(tiptapEditor, text)
                }
            })
            .catch(err => captureException('pasteAsMarkdown.readText', err))
    }

    return (
        <MenuBarMenu menuId="edit" label="Edit">
            <Menu.Item onPress={() => commands.undo()} isDisabled={disabled}>
                <Menu.ItemTitle>Undo</Menu.ItemTitle>
                <MenuShortcut keys="⌘Z" />
            </Menu.Item>
            <Menu.Item onPress={() => commands.redo()} isDisabled={disabled}>
                <Menu.ItemTitle>Redo</Menu.ItemTitle>
                <MenuShortcut keys="⌘Y" />
            </Menu.Item>
            <Separator />
            <Menu.Item onPress={() => commands.cut?.()} isDisabled={editDisabled}>
                <Menu.ItemTitle>Cut</Menu.ItemTitle>
                <MenuShortcut keys="⌘X" />
            </Menu.Item>
            <Menu.Item onPress={() => commands.copy?.()} isDisabled={editDisabled}>
                <Menu.ItemTitle>Copy</Menu.ItemTitle>
                <MenuShortcut keys="⌘C" />
            </Menu.Item>
            <Menu.Item onPress={() => commands.paste?.()} isDisabled={disabled}>
                <Menu.ItemTitle>Paste</Menu.ItemTitle>
                <MenuShortcut keys="⌘V" />
            </Menu.Item>
            <Menu.Item onPress={pasteAsMarkdown} isDisabled={disabled || !tiptapEditor}>
                <Menu.ItemTitle>Paste as Markdown</Menu.ItemTitle>
            </Menu.Item>
            <Separator />
            <Menu.Item onPress={openFindReplace} isDisabled={disabled}>
                <Menu.ItemTitle>Find…</Menu.ItemTitle>
                <MenuShortcut keys="⌘F" />
            </Menu.Item>
            <Separator />
            <Menu.Item onPress={() => commands.selectAll?.()} isDisabled={disabled}>
                <Menu.ItemTitle>Select all</Menu.ItemTitle>
                <MenuShortcut keys="⌘A" />
            </Menu.Item>
            <Menu.Item onPress={() => commands.deleteSelection?.()} isDisabled={editDisabled}>
                <Menu.ItemTitle>Delete</Menu.ItemTitle>
            </Menu.Item>
        </MenuBarMenu>
    )
}
