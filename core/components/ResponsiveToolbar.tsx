import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu, Separator } from '@tinycld/core/ui/menu'
import type { LucideIcon } from 'lucide-react-native'
import { EllipsisVertical } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Platform, Pressable, ScrollView, View } from 'react-native'
import { MenuActionItem } from './DropdownMenu'
import { ToolbarIconButton } from './ToolbarIconButton'
import { ToolbarSeparator } from './ToolbarSeparator'

// ── Item types ──

export type ToolbarItem =
    | {
          type: 'button'
          key: string
          icon: LucideIcon
          label: string
          onPress: () => void
          disabled?: boolean
      }
    | { type: 'menu'; key: string; icon: LucideIcon; label: string; children: ReactNode }
    | { type: 'separator' }
    | {
          type: 'custom'
          key: string
          element: ReactNode
          overflowLabel?: string
          overflowIcon?: LucideIcon
          overflowPress?: () => void
      }

interface ResponsiveToolbarProps {
    items: ToolbarItem[]
    rightItems?: ToolbarItem[]
    height?: number
}

// ── Native: simple flex-row, no overflow logic ──

function NativeToolbar({ items, rightItems, height = 44 }: ResponsiveToolbarProps) {
    return (
        <View className="flex-row items-center px-2" style={{ height }}>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ alignItems: 'center', gap: 2 }}
                style={{ flex: 1 }}
                keyboardShouldPersistTaps="handled"
            >
                {items.map((item, i) => (
                    <RenderItem key={itemKey(item, i)} item={item} />
                ))}
            </ScrollView>
            {rightItems && rightItems.length > 0 && (
                <View className="flex-row items-center gap-0.5 pl-2">
                    {rightItems.map((item, i) => (
                        <RenderItem key={itemKey(item, i)} item={item} />
                    ))}
                </View>
            )}
        </View>
    )
}

// ── Web: measure + overflow ──

const OVERFLOW_BUTTON_WIDTH = 34

function WebToolbar({ items, rightItems, height = 44 }: ResponsiveToolbarProps) {
    const containerRef = useRef<HTMLDivElement>(null)
    const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map())
    const itemWidths = useRef<Map<string, number>>(new Map())
    const rightRef = useRef<HTMLDivElement>(null)

    // Measurement strategy: render every item into the visible row on first paint
    // (hidden via CSS until we know how many fit), read their widths via refs, and
    // cache them by itemKey. A second render then shows only the items that fit.
    // Rendering one row — rather than a visible row plus a hidden twin — keeps
    // aria-labels and visible text unique in the DOM, which matters for
    // Playwright's strict-mode locators and for assistive tech.
    const [visibleCount, setVisibleCount] = useState<number | null>(null)

    // If the items prop gained an entry we haven't measured yet, drop back into
    // the measurement phase so the layout effect can read its width.
    const allCached = items.every((item, i) => itemWidths.current.has(itemKey(item, i)))
    if (visibleCount !== null && !allCached) {
        setVisibleCount(null)
    }

    const getItemWidth = useCallback((index: number, item: ToolbarItem): number => {
        const key = itemKey(item, index)
        const el = itemRefs.current.get(index)
        if (el) {
            const w = el.offsetWidth
            if (w > 0) itemWidths.current.set(key, w)
        }
        return itemWidths.current.get(key) ?? 0
    }, [])

    const recalculate = useCallback(() => {
        const container = containerRef.current
        if (!container) return

        const containerWidth = container.offsetWidth
        const rightWidth = rightRef.current?.offsetWidth ?? 0
        const available = containerWidth - rightWidth - 8

        let usedWidth = 0
        let fitCount = items.length

        for (let i = 0; i < items.length; i++) {
            const w = getItemWidth(i, items[i])
            const needed = usedWidth + w

            if (needed > available) {
                const availableWithOverflow = available - OVERFLOW_BUTTON_WIDTH
                let recalcWidth = 0
                fitCount = 0
                for (let j = 0; j < i; j++) {
                    const wJ = getItemWidth(j, items[j])
                    if (recalcWidth + wJ > availableWithOverflow) break
                    recalcWidth += wJ
                    fitCount = j + 1
                }
                break
            }
            usedWidth = needed
        }

        while (fitCount > 0 && items[fitCount - 1].type === 'separator') {
            fitCount--
        }

        setVisibleCount(prev => (prev === fitCount ? prev : fitCount))
    }, [items, getItemWidth])

    useLayoutEffect(() => {
        const container = containerRef.current
        if (!container) return

        recalculate()

        const observer = new ResizeObserver(() => {
            requestAnimationFrame(recalculate)
        })
        observer.observe(container)
        return () => observer.disconnect()
    }, [recalculate])

    const isMeasuring = visibleCount === null
    const shownItems = isMeasuring ? items : items.slice(0, visibleCount)
    const overflowItems = isMeasuring ? [] : items.slice(visibleCount)
    const hasOverflow = overflowItems.length > 0
    const trimmedOverflow = trimSeparators(overflowItems)

    return (
        <div
            ref={containerRef}
            style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                height,
                paddingLeft: 8,
                paddingRight: 8,
                overflow: 'visible',
                position: 'relative',
            }}
        >
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 2,
                    overflow: 'visible',
                    // Hide the measurement render so users don't see items briefly
                    // overflow before they collapse into the overflow menu.
                    visibility: isMeasuring ? 'hidden' : 'visible',
                }}
            >
                {shownItems.map((item, i) => (
                    <div
                        key={itemKey(item, i)}
                        ref={el => {
                            if (el) itemRefs.current.set(i, el)
                            else itemRefs.current.delete(i)
                        }}
                        style={{ display: 'inline-flex', alignItems: 'center' }}
                    >
                        <RenderItem item={item} />
                    </div>
                ))}
                {hasOverflow && <OverflowMenu items={trimmedOverflow} />}
            </div>

            {rightItems && rightItems.length > 0 && (
                <div
                    ref={rightRef}
                    style={{
                        display: 'flex',
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 2,
                        overflow: 'visible',
                        flexShrink: 0,
                    }}
                >
                    {rightItems.map((item, i) => (
                        <div
                            key={itemKey(item, i)}
                            style={{ display: 'inline-flex', alignItems: 'center' }}
                        >
                            <RenderItem item={item} />
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

// ── Overflow menu ──

function OverflowMenu({ items }: { items: ToolbarItem[] }) {
    const mutedColor = useThemeColor('muted-foreground')

    return (
        <Menu>
            <Menu.Trigger>
                <Pressable className="p-2 rounded-full" accessibilityLabel="More actions">
                    <EllipsisVertical size={18} color={mutedColor} />
                </Pressable>
            </Menu.Trigger>
            <Menu.Portal>
                <Menu.Overlay />
                <Menu.Content presentation="popover" placement="bottom" align="start">
                    {items.map((item, i) => (
                        <OverflowItem key={overflowKey(item, i)} item={item} />
                    ))}
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}

function OverflowItem({ item }: { item: ToolbarItem }) {
    switch (item.type) {
        case 'button':
            return (
                <MenuActionItem
                    label={item.label}
                    icon={item.icon}
                    onPress={item.onPress}
                    disabled={item.disabled}
                />
            )
        case 'menu':
            return (
                <>
                    <Menu.Label>{item.label}</Menu.Label>
                    {item.children}
                    <Separator />
                </>
            )
        case 'separator':
            return <Separator />
        case 'custom':
            if (item.overflowPress) {
                return (
                    <MenuActionItem
                        label={item.overflowLabel ?? ''}
                        icon={item.overflowIcon}
                        onPress={item.overflowPress}
                    />
                )
            }
            return null
    }
}

// ── Render inline items ──

function RenderItem({ item }: { item: ToolbarItem }) {
    switch (item.type) {
        case 'button':
            return (
                <ToolbarIconButton
                    icon={item.icon}
                    label={item.label}
                    onPress={item.onPress}
                    disabled={item.disabled}
                />
            )
        case 'menu':
            return (
                <Menu>
                    <Menu.Trigger>
                        <ToolbarIconButton icon={item.icon} label={item.label} />
                    </Menu.Trigger>
                    <Menu.Portal>
                        <Menu.Overlay />
                        <Menu.Content presentation="popover" placement="bottom" align="start">
                            {item.children}
                        </Menu.Content>
                    </Menu.Portal>
                </Menu>
            )
        case 'separator':
            return <ToolbarSeparator />
        case 'custom':
            return <>{item.element}</>
    }
}

// ── Helpers ──

function itemKey(item: ToolbarItem, index: number): string {
    if (item.type === 'separator') return `sep-${index}`
    return item.key
}

function overflowKey(item: ToolbarItem, index: number): string {
    if (item.type === 'separator') return `overflow-sep-${index}`
    if (item.type === 'custom') return `overflow-${item.key}`
    if (item.type === 'button' || item.type === 'menu') return `overflow-${item.key}`
    return `overflow-${index}`
}

function trimSeparators(items: ToolbarItem[]): ToolbarItem[] {
    let start = 0
    while (start < items.length && items[start].type === 'separator') start++
    let end = items.length - 1
    while (end >= start && items[end].type === 'separator') end--
    return items.slice(start, end + 1)
}

// ── Export ──

export function ResponsiveToolbar(props: ResponsiveToolbarProps) {
    if (Platform.OS !== 'web') return <NativeToolbar {...props} />
    return <WebToolbar {...props} />
}
