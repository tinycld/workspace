import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useWebStyles } from '@tinycld/core/lib/use-web-styles'
import type { LucideIcon } from 'lucide-react-native'
import { Platform, Pressable } from 'react-native'

const tooltipCSS = `
    .hover-action-tooltip {
        position: relative;
        display: inline-flex;
    }
    .hover-action-tooltip::after {
        content: attr(data-tooltip);
        position: absolute;
        left: 50%;
        transform: translateX(-50%);
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 12px;
        line-height: 1;
        white-space: nowrap;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.15s ease-in;
        background: var(--tooltip-bg);
        color: var(--tooltip-fg);
        z-index: 10;
    }
    .hover-action-tooltip.tooltip-above::after {
        bottom: calc(100% + 6px);
    }
    .hover-action-tooltip.tooltip-below::after {
        top: calc(100% + 6px);
    }
    .hover-action-tooltip:hover::after {
        opacity: 1;
    }
`

export function HoverAction({
    icon: Icon,
    label,
    onPress,
    iconColor,
    iconFill,
    tooltipPosition = 'above',
}: {
    icon: LucideIcon
    label: string
    onPress?: () => void
    iconColor?: string
    iconFill?: string
    tooltipPosition?: 'above' | 'below'
}) {
    useWebStyles('hover-action-tooltip', tooltipCSS)
    const mutedColor = useThemeColor('muted-foreground')
    const surfaceColor = useThemeColor('surface')
    const fgColor = useThemeColor('foreground')

    const button = (
        <Pressable
            className="p-1.5 rounded-full"
            onPress={e => {
                e.stopPropagation()
                e.preventDefault()
                onPress?.()
            }}
            accessibilityLabel={label}
        >
            <Icon size={16} color={iconColor ?? mutedColor} fill={iconFill ?? 'none'} />
        </Pressable>
    )

    if (Platform.OS !== 'web') return button

    const tooltipStyle = {
        '--tooltip-bg': surfaceColor,
        '--tooltip-fg': fgColor,
    }

    return (
        <div
            data-tooltip={label}
            className={`hover-action-tooltip tooltip-${tooltipPosition}`}
            style={tooltipStyle as never}
        >
            {button}
        </div>
    )
}
