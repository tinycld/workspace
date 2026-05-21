import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useWebStyles } from '@tinycld/core/lib/use-web-styles'
import type { ReactNode } from 'react'
import { Platform } from 'react-native'

// Tooltip appears above the toolbar button on web only — matches the
// pattern used by the @tinycld/calc toolbar. We hand-roll a CSS-only
// tooltip (vs. a portaled JS popover) so it does not steal focus from
// the ProseMirror editor and stays cheap to render across the ~20
// toolbar buttons. 200ms hover delay avoids flashes during quick
// scans. Above-button positioning keeps the tip from being clipped by
// react-native-web's default `overflow:hidden` on sibling rows.
const tooltipCSS = `
    .text-toolbar-tooltip {
        position: relative;
        display: inline-flex;
    }
    .text-toolbar-tooltip::after {
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
        background: var(--text-tooltip-bg);
        color: var(--text-tooltip-fg);
        z-index: 10;
    }
    .text-toolbar-tooltip:hover::after {
        opacity: 1;
    }
`

interface ToolbarTooltipProps {
    label: string
    children: ReactNode
}

export function ToolbarTooltip({ label, children }: ToolbarTooltipProps) {
    useWebStyles('text-toolbar-tooltip', tooltipCSS)
    const tooltipBg = useThemeColor('foreground')
    const tooltipFg = useThemeColor('background')

    if (Platform.OS !== 'web') return <>{children}</>

    const tooltipStyle = {
        '--text-tooltip-bg': tooltipBg,
        '--text-tooltip-fg': tooltipFg,
    }
    return (
        <div data-tooltip={label} className="text-toolbar-tooltip" style={tooltipStyle as never}>
            {children}
        </div>
    )
}
