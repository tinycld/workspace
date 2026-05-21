import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useWebStyles } from '@tinycld/core/lib/use-web-styles'
import type { ComponentType, ReactNode } from 'react'
import { forwardRef } from 'react'
import { Platform, Pressable, View } from 'react-native'

export interface ToolbarButtonProps {
    icon?: ComponentType<{ size?: number; color?: string }>
    children?: ReactNode
    active?: boolean
    disabled?: boolean
    onPress?: () => void
    label: string
    width?: number
}

// Tooltip appears above the button. The toolbar sits below the menu
// bar, so there's room overhead, and an above-tooltip doesn't get
// clipped by the row of UI directly below (formula bar, banners) —
// react-native-web's View emits overflow:hidden by default, which
// would clip a below-tooltip extending into a sibling row.
//
// The 200ms delay matches platform conventions and avoids flashing
// tooltips during quick toolbar scans.
const tooltipCSS = `
    .calc-toolbar-tooltip {
        position: relative;
        display: inline-flex;
    }
    .calc-toolbar-tooltip::after {
        content: attr(data-tooltip);
        position: absolute;
        bottom: calc(100% + 4px);
        left: 50%;
        transform: translateX(-50%);
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 12px;
        line-height: 1;
        white-space: nowrap;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.15s ease-in 0.2s;
        background: var(--calc-tooltip-bg);
        color: var(--calc-tooltip-fg);
        z-index: 10;
    }
    .calc-toolbar-tooltip:hover::after {
        opacity: 1;
    }
`

// Shared toolbar button. The icon prop is the common case (Lucide
// component); for buttons whose visual is text or a composition (e.g.
// the "123 ▾" format menu trigger), pass `children` instead.
//
// `forwardRef` is required so this can serve as a Menu.Trigger child:
// the trigger reads the wrapper's measured rect via the ref to
// position the popover.
export const ToolbarButton = forwardRef<View, ToolbarButtonProps>(function ToolbarButton(
    { icon: Icon, children, active = false, disabled = false, onPress, label, width = 28 },
    ref
) {
    useWebStyles('calc-toolbar-tooltip', tooltipCSS)
    const fg = useThemeColor('foreground')
    const tooltipBg = useThemeColor('foreground')
    const tooltipFg = useThemeColor('background')

    const button = (
        <Pressable
            ref={ref}
            onPress={onPress}
            disabled={disabled}
            accessibilityLabel={label}
            accessibilityRole="button"
            accessibilityState={{ disabled, selected: active }}
            hitSlop={Platform.OS === 'web' ? undefined : { top: 6, bottom: 6, left: 4, right: 4 }}
            className={`items-center justify-center rounded ${active ? 'bg-accent' : ''}`}
            style={{ width, height: 24, marginHorizontal: 1, opacity: disabled ? 0.4 : 1 }}
        >
            {Icon != null ? <Icon size={14} color={fg} /> : children}
        </Pressable>
    )

    if (Platform.OS !== 'web') return button

    const tooltipStyle = {
        '--calc-tooltip-bg': tooltipBg,
        '--calc-tooltip-fg': tooltipFg,
    }

    return (
        <div data-tooltip={label} className="calc-toolbar-tooltip" style={tooltipStyle as never}>
            {button}
        </div>
    )
})

export function ToolbarDivider() {
    return <View className="bg-border" style={{ width: 1, height: 16, marginHorizontal: 4 }} />
}
