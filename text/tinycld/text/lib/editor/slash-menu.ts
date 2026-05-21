import { Extension } from '@tiptap/core'
import Suggestion, { exitSuggestion, type SuggestionOptions } from '@tiptap/suggestion'
import {
    type SlashMenuCommand,
    SLASH_MENU_COMMANDS,
    filterSlashMenuCommands,
} from './slash-menu-commands'
import {
    createSlashMenuBridgeRender,
    defaultNewRequestId,
    defaultPostToHost,
} from './slash-menu-render-bridge'
import { createSlashMenuStoreRender } from './slash-menu-render-store'
import { type SlashMenuOptions, slashMenuPluginKey } from './slash-menu-shared'

// Re-exports kept for backward compatibility with downstream consumers
// (SlashMenuPopover imports SerializedSlashMenuItem; tests import the
// bridge factory + helpers). New code should import directly from the
// strategy / shared modules.
export { createSlashMenuBridgeRender } from './slash-menu-render-bridge'
export type { SlashMenuBridgeDeps } from './slash-menu-render-bridge'
export {
    type SerializedSlashMenuItem,
    type SlashMenuOptions,
    serializeSlashMenuItems,
    slashMenuPluginKey,
    toAnchoredSlashMenuRect,
} from './slash-menu-shared'

// SlashMenu wires Tiptap's @tiptap/suggestion plugin to one of two
// render strategies — the store-driven flow (web variant) or the
// bridge-driven flow that posts messages over the WebView (native).
// The suggestion plugin owns trigger detection + range tracking; the
// strategy decides where the popover state lives.
//
// Strategies live in sibling modules (slash-menu-render-store.ts,
// slash-menu-render-bridge.ts) so each can be reasoned about — and
// imported — independently. This file is just the Extension wiring.
export const SlashMenu = Extension.create<SlashMenuOptions>({
    name: 'tinycldSlashMenu',

    addOptions() {
        return {
            openImageInsert: undefined,
            renderStrategy: 'store',
        }
    },

    addProseMirrorPlugins() {
        const extension = this

        // command runs the chosen entry. The suggestion plugin invokes
        // this via the host's response (bridge) or the store's
        // `onSelect` indirection (store) — we capture the editor +
        // range here so the closure can hand them to the command's
        // `run({...})`. Calling `editor.chain().focus()` refocuses the
        // editor after the popover (which lives outside the editor's
        // DOM) intercepts the Enter / click.
        const runCommand: NonNullable<SuggestionOptions<SlashMenuCommand>['command']> = ({
            editor,
            range,
            props,
        }) => {
            props.run({
                editor,
                range,
                openImageInsert: extension.options.openImageInsert,
            })
        }

        // Bridge render strategy. The popover lives on the host (native
        // side); we communicate over the WebView message bus. The
        // factory takes injected dependencies (postToHost, newRequestId,
        // exitSuggestion) so the bridge logic can be unit-tested
        // without needing a real WebView; here we pass the real ones.
        const render =
            extension.options.renderStrategy === 'bridge'
                ? createSlashMenuBridgeRender({
                      postToHost: defaultPostToHost,
                      newRequestId: defaultNewRequestId,
                      exitSuggestion,
                  })
                : createSlashMenuStoreRender()

        return [
            Suggestion<SlashMenuCommand>({
                editor: this.editor,
                pluginKey: slashMenuPluginKey,
                char: '/',
                // Match `/` at the start of a node OR after whitespace.
                // The suggestion plugin's default `allowedPrefixes` is
                // `[' ']`, which already covers the "after whitespace"
                // case — we keep the default. `startOfLine: false`
                // lets the trigger fire mid-line too (e.g. after a
                // line break or in any text block beginning).
                startOfLine: false,
                allowSpaces: false,
                items: ({ query }) => filterSlashMenuCommands(query, SLASH_MENU_COMMANDS),
                command: runCommand,
                render,
            }),
        ]
    },
})
