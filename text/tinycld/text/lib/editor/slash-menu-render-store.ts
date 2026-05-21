import type { SuggestionOptions } from '@tiptap/suggestion'
import { useSlashMenuStore } from '../stores/slash-menu-store'
import type { SlashMenuCommand } from './slash-menu-commands'

// Store render strategy for SlashMenu. Drives useSlashMenuStore so the
// web-only popover (SlashMenu.web.tsx) can render against a Zustand
// snapshot. The suggestion plugin's onKeyDown handler reads keyboard
// state directly off the store and reflects arrow/enter/escape into
// it; the popover component just renders whatever it sees.
//
// Lives in its own module so the bridge render strategy (which has no
// store dependency) can be imported by the WebView without pulling in
// Zustand. The slash-menu.ts Extension picks one factory or the other
// based on its renderStrategy option.

// Helper to translate the suggestion plugin's clientRect (DOMRect |
// null) into the serializable anchor shape the store holds. The store
// doesn't want to keep a DOMRect reference whose values mutate between
// frames, and the SlashMenu.web.tsx popover wants top/bottom/left/right
// (the bridge wire shape only carries top/left + width/height).
function toAnchor(rect: DOMRect | null | undefined) {
    if (!rect) return null
    return {
        top: rect.top,
        left: rect.left,
        bottom: rect.bottom,
        right: rect.right,
        width: rect.width,
        height: rect.height,
    }
}

export function createSlashMenuStoreRender(): NonNullable<
    SuggestionOptions<SlashMenuCommand>['render']
> {
    return () => {
        // The latest `command` callback from the suggestion plugin.
        // We close over a mutable reference rather than capturing
        // `onStart`'s props, because the plugin re-creates the
        // command on each transaction with an updated range — using
        // the stale closure would apply the heading at the original
        // `/` position even after the user typed more characters.
        let currentCommand: ((cmd: SlashMenuCommand) => void) | null = null

        const handleSelect = (cmd: SlashMenuCommand) => {
            currentCommand?.(cmd)
        }

        return {
            onStart: props => {
                currentCommand = props.command
                useSlashMenuStore.getState().open({
                    items: props.items,
                    query: props.query,
                    anchor: toAnchor(props.clientRect?.() ?? null),
                    onSelect: handleSelect,
                })
            },
            onUpdate: props => {
                currentCommand = props.command
                useSlashMenuStore.getState().update({
                    items: props.items,
                    query: props.query,
                    anchor: toAnchor(props.clientRect?.() ?? null),
                })
            },
            onKeyDown: ({ event }) => {
                const state = useSlashMenuStore.getState()
                if (!state.isOpen) return false

                if (event.key === 'ArrowDown') {
                    state.moveSelection(1)
                    event.preventDefault()
                    return true
                }
                if (event.key === 'ArrowUp') {
                    state.moveSelection(-1)
                    event.preventDefault()
                    return true
                }
                if (event.key === 'Enter') {
                    const item = state.items[state.selectedIndex]
                    if (!item) return false
                    state.onSelect?.(item)
                    event.preventDefault()
                    return true
                }
                if (event.key === 'Escape') {
                    useSlashMenuStore.getState().close()
                    event.preventDefault()
                    return true
                }
                return false
            },
            onExit: () => {
                currentCommand = null
                useSlashMenuStore.getState().close()
            },
        }
    }
}
