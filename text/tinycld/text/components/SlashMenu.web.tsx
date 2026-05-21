import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import type { LucideIcon } from 'lucide-react-native'
import { useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Pressable, Text, View } from 'react-native'
import { resolveSlashMenuIcon } from '../lib/editor/slash-menu-icon-lookup'
import type { SlashMenuAnchor } from '../lib/stores/slash-menu-store'
import { useSlashMenuStore } from '../lib/stores/slash-menu-store'

// Vertical gap between the caret and the popover so the menu doesn't
// crowd the line of text the user is typing on. Tuned by eye.
const POPOVER_GAP_PX = 4
// Estimated popover height used to flip above the caret when there
// isn't room below. A precise post-measure flip would feel snappier
// but adds a layout-then-paint flicker; the rough estimate is fine
// for v1 and matches how Tiptap's built-in tippy positioning behaves.
const POPOVER_HEIGHT_ESTIMATE_PX = 320
const POPOVER_WIDTH_PX = 260

// resolvePosition picks { top, left } in viewport coords given the
// anchor rect. Flips above the caret when the estimated popover
// height would extend past the viewport — without this, the menu
// disappears off-screen near the bottom of a long document.
function resolvePosition(anchor: SlashMenuAnchor): { top: number; left: number } {
    if (typeof window === 'undefined') {
        return { top: anchor.bottom + POPOVER_GAP_PX, left: anchor.left }
    }
    const viewportHeight = window.innerHeight
    const viewportWidth = window.innerWidth
    const wouldOverflowBottom =
        anchor.bottom + POPOVER_GAP_PX + POPOVER_HEIGHT_ESTIMATE_PX > viewportHeight
    const top = wouldOverflowBottom
        ? Math.max(8, anchor.top - POPOVER_GAP_PX - POPOVER_HEIGHT_ESTIMATE_PX)
        : anchor.bottom + POPOVER_GAP_PX
    const left = Math.min(
        Math.max(8, anchor.left),
        Math.max(8, viewportWidth - POPOVER_WIDTH_PX - 8)
    )
    return { top, left }
}

// SlashMenu renders the floating popover for the `/`-trigger command
// palette. Listens to the Zustand store driven by the SlashMenu Tiptap
// extension (lib/editor/slash-menu.ts). Web-only: portals to the
// document body so the popover overlays the editor surface without
// being clipped by the editor's scroll container.
//
// The native variant takes a `webViewRef` prop the controller needs
// for .measure() / .postMessage(); the web mount accepts the same
// prop signature and ignores it so the screen-level mount is
// platform-agnostic.
export function SlashMenu({}: { webViewRef?: React.RefObject<unknown> | null } = {}) {
    // webViewRef accepted for cross-platform parity; the web variant
    // renders via portals so it has no use for the ref.
    const isOpen = useSlashMenuStore(s => s.isOpen)
    const items = useSlashMenuStore(s => s.items)
    const anchor = useSlashMenuStore(s => s.anchor)
    const selectedIndex = useSlashMenuStore(s => s.selectedIndex)
    const onSelect = useSlashMenuStore(s => s.onSelect)
    const close = useSlashMenuStore(s => s.close)

    // Click-outside dismiss. The suggestion plugin already closes on
    // text changes that invalidate the trigger, but a stray click on
    // the page (toolbar, sidebar) doesn't generate a transaction and
    // would leave the popover stranded.
    useEffect(() => {
        if (!isOpen || typeof document === 'undefined') return
        function onPointerDown(event: MouseEvent) {
            const target = event.target
            if (!(target instanceof Element)) return
            if (target.closest('[data-tinycld-slash-menu]')) return
            close()
        }
        document.addEventListener('mousedown', onPointerDown, true)
        return () => document.removeEventListener('mousedown', onPointerDown, true)
    }, [isOpen, close])

    const position = useMemo(() => (anchor ? resolvePosition(anchor) : null), [anchor])

    if (!isOpen || !position || typeof document === 'undefined') return null
    if (items.length === 0) return null

    // Listbox+option pairing throughout — screen readers expect a
    // listbox container to contain only `role="option"` children, with
    // the active descendant announced via aria-activedescendant. The
    // `data-tinycld-slash-menu` attribute is the hook the click-outside
    // listener uses to scope dismissal.
    const containerDomProps = {
        'data-tinycld-slash-menu': 'true',
        role: 'listbox',
        'aria-label': 'Slash menu',
    } as object

    return createPortal(
        <View
            accessibilityRole="menu"
            accessibilityLabel="Slash menu"
            {...containerDomProps}
            style={{
                position: 'fixed',
                top: position.top,
                left: position.left,
                width: POPOVER_WIDTH_PX,
                maxHeight: POPOVER_HEIGHT_ESTIMATE_PX,
                zIndex: 1000,
            } as object}
            className="rounded-lg border border-border bg-background py-1 overflow-hidden shadow-lg"
        >
            <View style={{ maxHeight: POPOVER_HEIGHT_ESTIMATE_PX, overflowY: 'auto' } as object}>
                {items.map((item, index) => (
                    <SlashMenuRow
                        key={item.id}
                        label={item.label}
                        Icon={resolveSlashMenuIcon(item.iconName)}
                        isSelected={index === selectedIndex}
                        onPress={() => onSelect?.(item)}
                    />
                ))}
            </View>
        </View>,
        document.body
    )
}

interface SlashMenuRowProps {
    label: string
    Icon: LucideIcon | null
    isSelected: boolean
    onPress: () => void
}

function SlashMenuRow({ label, Icon, isSelected, onPress }: SlashMenuRowProps) {
    const foregroundColor = useThemeColor('foreground')
    // role="option" matches the parent listbox; aria-selected exposes
    // the current keyboard-highlight to screen readers without needing
    // a separate live region for the active descendant.
    const optionDomProps = {
        role: 'option',
        'aria-selected': isSelected,
    } as const
    return (
        <Pressable
            onPress={onPress}
            accessibilityLabel={label}
            {...optionDomProps}
            className={`flex-row items-center gap-2 px-3 py-2 ${
                isSelected ? 'bg-surface-secondary' : 'bg-transparent'
            }`}
        >
            {Icon ? <Icon size={16} color={foregroundColor} /> : null}
            <Text className="text-sm text-foreground">{label}</Text>
        </Pressable>
    )
}
