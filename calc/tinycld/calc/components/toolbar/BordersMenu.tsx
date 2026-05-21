import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu, useOpenMenu } from '@tinycld/core/ui/menubar'
import { Grid3x3 } from 'lucide-react-native'

import { useCallback } from 'react'
import { Platform, Pressable, Text, View } from 'react-native'
import { useBordersPickerStore } from '../../hooks/use-borders-picker-store'
import type { BorderPresetId } from '../../lib/border-presets'
import type { CellBorderEdge, CellBorderLineStyle, CellBorders } from '../../lib/workbook-types'
import {
    BorderAlllIcon,
    BorderBottomIcon,
    BorderHorizontalIcon,
    BorderInnerIcon,
    BorderLeftIcon,
    BorderNoneIcon,
    BorderOuterIcon,
    BorderRightIcon,
    BorderTopIcon,
    BorderVerticalIcon,
    type Icon,
} from '../icons'
import { BORDERS_PALETTE } from './ColorPickerMenu'
import { ToolbarButton } from './ToolbarButton'

interface PatternOption {
    id: BorderPresetId
    label: string
    icon: Icon
}

// Ten border patterns laid out as a 5x2 grid in the popover. Order
// matches the screenshot reference: top row is the perimeter / clear
// family, bottom row is the per-side family.
const PATTERN_OPTIONS: readonly PatternOption[] = [
    { id: 'none', label: 'No borders', icon: BorderNoneIcon },
    { id: 'all', label: 'All borders', icon: BorderAlllIcon },
    { id: 'inner', label: 'Inner borders', icon: BorderInnerIcon },
    { id: 'innerH', label: 'Border horizontal', icon: BorderHorizontalIcon },
    { id: 'innerV', label: 'Border vertical', icon: BorderVerticalIcon },
    { id: 'outer', label: 'Outer', icon: BorderOuterIcon },
    { id: 'top', label: 'Top', icon: BorderTopIcon },
    { id: 'bottom', label: 'Bottom', icon: BorderBottomIcon },
    { id: 'left', label: 'Left', icon: BorderLeftIcon },
    { id: 'right', label: 'Right', icon: BorderRightIcon },
]

// Six line-style previews mirror the writer's supported set. Visual
// width / dash pattern is hand-tuned in renderLinePreview below.
const LINE_STYLES: readonly { id: CellBorderLineStyle; label: string }[] = [
    { id: 'thin', label: 'Thin' },
    { id: 'medium', label: 'Medium' },
    { id: 'thick', label: 'Thick' },
    { id: 'dashed', label: 'Dashed' },
    { id: 'dotted', label: 'Dotted' },
    { id: 'double', label: 'Double' },
]

interface BordersMenuProps {
    borders: CellBorders | undefined
    disabled: boolean
    onSetBorders: (presetId: BorderPresetId) => void
}

export function BordersMenu({ borders, disabled, onSetBorders }: BordersMenuProps) {
    const fg = useThemeColor('foreground')
    const accent = useThemeColor('accent')
    const border = useThemeColor('border')
    const muted = useThemeColor('muted-foreground')
    const [isOpen, setIsOpen] = useOpenMenu('toolbar:borders')
    const pickerColor = useBordersPickerStore(s => s.color)
    const pickerStyle = useBordersPickerStore(s => s.style)
    const setPickerColor = useBordersPickerStore(s => s.setColor)
    const setPickerStyle = useBordersPickerStore(s => s.setStyle)

    const onSelect = useCallback(
        (id: BorderPresetId) => {
            onSetBorders(id)
            setIsOpen(false)
        },
        [onSetBorders, setIsOpen]
    )

    const activeId = matchActiveOption(borders)

    return (
        <Menu isOpen={isOpen} onOpenChange={setIsOpen}>
            <View {...(typeof document !== 'undefined' ? { 'data-tinycld-menu': 'trigger' } : {})}>
                <Menu.Trigger>
                    <ToolbarButton label="Borders" icon={Grid3x3} disabled={disabled} />
                </Menu.Trigger>
            </View>
            <Menu.Portal>
                <Menu.Content placement="bottom" align="start">
                    <View
                        className="flex-row"
                        style={{ padding: 8, gap: 8 }}
                        {...(typeof document !== 'undefined'
                            ? { 'data-tinycld-menu': 'content' }
                            : {})}
                    >
                        <View style={{ width: 5 * 28, gap: 2 }}>
                            <View className="flex-row" style={{ gap: 2 }}>
                                {PATTERN_OPTIONS.slice(0, 5).map(option => (
                                    <PatternButton
                                        key={option.id}
                                        option={option}
                                        isActive={option.id === activeId}
                                        accent={accent}
                                        fg={fg}
                                        onSelect={onSelect}
                                    />
                                ))}
                            </View>
                            <View className="flex-row" style={{ gap: 2 }}>
                                {PATTERN_OPTIONS.slice(5).map(option => (
                                    <PatternButton
                                        key={option.id}
                                        option={option}
                                        isActive={option.id === activeId}
                                        accent={accent}
                                        fg={fg}
                                        onSelect={onSelect}
                                    />
                                ))}
                            </View>
                        </View>
                        <View style={{ width: 1, backgroundColor: border }} />
                        <View style={{ gap: 8, width: 5 * 24 + 4 * 4 }}>
                            <ColorSwatchRow
                                color={pickerColor}
                                accent={accent}
                                border={border}
                                fg={fg}
                                muted={muted}
                                onSelect={setPickerColor}
                            />
                            <View style={{ gap: 2 }}>
                                {LINE_STYLES.map(line => (
                                    <LineStyleRow
                                        key={line.id}
                                        line={line}
                                        isActive={line.id === pickerStyle}
                                        accent={accent}
                                        border={border}
                                        fg={fg}
                                        onSelect={setPickerStyle}
                                    />
                                ))}
                            </View>
                        </View>
                    </View>
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}

interface PatternButtonProps {
    option: PatternOption
    isActive: boolean
    accent: string
    fg: string
    onSelect: (id: BorderPresetId) => void
}

function PatternButton({ option, isActive, accent, fg, onSelect }: PatternButtonProps) {
    const Icon = option.icon
    return (
        <Pressable
            onPress={() => onSelect(option.id)}
            accessibilityLabel={option.label}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            hitSlop={Platform.OS === 'web' ? undefined : { top: 6, bottom: 6, left: 4, right: 4 }}
            className={`items-center justify-center rounded ${isActive ? 'bg-accent' : ''}`}
            style={{
                width: 28,
                height: 24,
                borderWidth: isActive ? 1 : 0,
                borderColor: accent,
            }}
        >
            <Icon size={14} color={fg} />
        </Pressable>
    )
}

interface ColorSwatchRowProps {
    color: string
    accent: string
    border: string
    fg: string
    muted: string
    onSelect: (color: string) => void
}

function ColorSwatchRow({ color, accent, border, fg, muted, onSelect }: ColorSwatchRowProps) {
    return (
        <View style={{ gap: 4 }}>
            <Text style={{ fontSize: 11, color: muted }}>Color</Text>
            <View className="flex-row flex-wrap" style={{ gap: 4 }}>
                {BORDERS_PALETTE.map(swatch => {
                    const isActive = color === swatch.hex
                    const isDefault = swatch.hex === ''
                    return (
                        <Pressable
                            key={swatch.label}
                            onPress={() => onSelect(swatch.hex || '#000000')}
                            accessibilityLabel={swatch.label}
                            accessibilityRole="button"
                            hitSlop={
                                Platform.OS === 'web'
                                    ? undefined
                                    : { top: 6, bottom: 6, left: 4, right: 4 }
                            }
                            style={{
                                width: 20,
                                height: 20,
                                borderRadius: 3,
                                borderWidth: isActive ? 2 : 1,
                                borderColor: isActive ? accent : border,
                                backgroundColor: isDefault ? 'transparent' : swatch.hex,
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            {isDefault ? (
                                <View
                                    style={{
                                        width: 14,
                                        height: 1,
                                        backgroundColor: fg,
                                    }}
                                />
                            ) : null}
                        </Pressable>
                    )
                })}
            </View>
        </View>
    )
}

interface LineStyleRowProps {
    line: { id: CellBorderLineStyle; label: string }
    isActive: boolean
    accent: string
    border: string
    fg: string
    onSelect: (id: CellBorderLineStyle) => void
}

function LineStyleRow({ line, isActive, accent, border, fg, onSelect }: LineStyleRowProps) {
    return (
        <Pressable
            onPress={() => onSelect(line.id)}
            accessibilityLabel={line.label}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            hitSlop={Platform.OS === 'web' ? undefined : { top: 6, bottom: 6, left: 4, right: 4 }}
            style={{
                paddingHorizontal: 6,
                paddingVertical: 4,
                borderRadius: 3,
                borderWidth: isActive ? 1 : 0,
                borderColor: isActive ? accent : border,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
            }}
        >
            <View style={{ flex: 1, height: 12, justifyContent: 'center' }}>
                {renderLinePreview(line.id, fg)}
            </View>
        </Pressable>
    )
}

// renderLinePreview draws a small horizontal sample for one line style.
// All previews fit in a 12pt-tall row so the picker stays compact.
function renderLinePreview(style: CellBorderLineStyle, color: string) {
    if (style === 'double') {
        return (
            <View>
                <View style={{ height: 1, backgroundColor: color }} />
                <View style={{ height: 2 }} />
                <View style={{ height: 1, backgroundColor: color }} />
            </View>
        )
    }
    if (style === 'dashed') {
        return (
            <View className="flex-row" style={{ gap: 3 }}>
                <View style={{ flex: 1, height: 1, backgroundColor: color }} />
                <View style={{ flex: 1, height: 1, backgroundColor: color }} />
                <View style={{ flex: 1, height: 1, backgroundColor: color }} />
                <View style={{ flex: 1, height: 1, backgroundColor: color }} />
            </View>
        )
    }
    if (style === 'dotted') {
        return (
            <View className="flex-row" style={{ gap: 2 }}>
                <View style={{ width: 1, height: 1, backgroundColor: color }} />
                <View style={{ width: 1, height: 1, backgroundColor: color }} />
                <View style={{ width: 1, height: 1, backgroundColor: color }} />
                <View style={{ width: 1, height: 1, backgroundColor: color }} />
                <View style={{ width: 1, height: 1, backgroundColor: color }} />
                <View style={{ width: 1, height: 1, backgroundColor: color }} />
                <View style={{ width: 1, height: 1, backgroundColor: color }} />
                <View style={{ width: 1, height: 1, backgroundColor: color }} />
            </View>
        )
    }
    const height = style === 'thick' ? 3 : style === 'medium' ? 2 : 1
    return <View style={{ height, backgroundColor: color }} />
}

// matchActiveOption reports which preset (if any) describes the
// current borders state. The "outer" and "all" options share an
// identical spec for single-cell scope (no inner edges to draw),
// so "all" wins the tie — keeping the highlight stable.
//
// With per-edge objects an edge is "set" when its value is a truthy
// object (not `false`/undefined). Mismatched edge counts (some object,
// some false, some undefined) collapse to "no preset matches".
function matchActiveOption(b: CellBorders | undefined): BorderPresetId | undefined {
    const top = isEdgeOn(b?.top)
    const right = isEdgeOn(b?.right)
    const bottom = isEdgeOn(b?.bottom)
    const left = isEdgeOn(b?.left)
    if (top && right && bottom && left) return 'all'
    if (b != null && b.top === false && b.right === false && b.bottom === false && b.left === false)
        return 'none'
    if (top && !right && !bottom && !left) return 'top'
    if (!top && !right && bottom && !left) return 'bottom'
    if (!top && !right && !bottom && left) return 'left'
    if (!top && right && !bottom && !left) return 'right'
    return undefined
}

function isEdgeOn(edge: CellBorderEdge | false | undefined): boolean {
    return edge != null && edge !== false
}
