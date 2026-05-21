import { PluginKey } from '@tiptap/pm/state'
import type { SlashMenuCommand } from './slash-menu-commands'
import type { SlashMenuIconName } from './slash-menu-icon-lookup'

// Unique plugin key so the suggestion plugin's `onKeyDown` bridge can
// target this instance — the editor may run other suggestion plugins
// later (mentions, emoji), and they must not share state.
export const slashMenuPluginKey = new PluginKey('tinycldSlashMenu')

// Lightweight wire shape posted to the host on show-popover /
// popover-update. The web LucideIcon refs (cmd.icon) can't ride the
// JSON-stringified message bus, so we substitute a string `iconName`
// the host maps back to the icon component via slash-menu-icon-lookup.
//
// `id` is the SlashMenuCommand.id (heading-1, bullet-list, …) — the
// host echoes it back in popover-result and the bridge looks the
// command up in SLASH_MENU_COMMANDS to invoke run().
export interface SerializedSlashMenuItem {
    id: string
    label: string
    iconName: SlashMenuIconName
}

// Configuration accepted by the SlashMenu Extension. Public surface
// because the screen-level mount passes openImageInsert; the
// renderStrategy switch is how Editor.tsx picks the bridge variant
// on native vs. the store variant on web.
export interface SlashMenuOptions {
    // Host-supplied side-effect for the "Image" command. The picker
    // (URL prompt, file picker, drive upload) lives at the screen
    // level — see screens/[id].tsx. Optional: when undefined, picking
    // the Image entry just removes the trigger and inserts nothing.
    openImageInsert?: () => void
    // Render strategy:
    //   'store'  - drive useSlashMenuStore. The web variant uses this;
    //              the popover (SlashMenu.web.tsx) reads the store
    //              directly and the suggestion plugin's onKeyDown
    //              handles arrow/enter/escape against the store state.
    //   'bridge' - post ui.show-popover / popover-update messages to
    //              the host via window.ReactNativeWebView. Used inside
    //              the native WebView, where the host-side overlay
    //              controller renders a Modal popover and routes
    //              selections back via popover-result.
    // Defaults to 'store'.
    renderStrategy?: 'store' | 'bridge'
}

// Serialize a command list into the lightweight wire shape the host's
// popover can render against. Strips icon refs (LucideIcon components
// can't ride JSON) and `run` (a host-side closure that lives only in
// the WebView). The host echoes `id` back in popover-result; the
// bridge looks the command up in SLASH_MENU_COMMANDS to invoke run().
export function serializeSlashMenuItems(
    items: SlashMenuCommand[]
): SerializedSlashMenuItem[] {
    return items.map(cmd => ({ id: cmd.id, label: cmd.label, iconName: cmd.iconName }))
}

// Convert the suggestion plugin's clientRect (a DOMRect) into the
// shape the host's anchored-overlay protocol expects: viewport coords
// + a snapshot of the WebView's scroll offsets at capture time.
// Matches ImageSelection.rect from Milestone B exactly.
export function toAnchoredSlashMenuRect(rect: DOMRect | null | undefined) {
    if (!rect) return null
    return {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        scrollX: typeof window !== 'undefined' ? window.scrollX : 0,
        scrollY: typeof window !== 'undefined' ? window.scrollY : 0,
    }
}
