import type { ComponentType } from 'react'
import Svg, { Path } from 'react-native-svg'

// Shape matches Lucide's icon contract: { size?: number; color?: string }.
// Components produced by makeIconFromPath can be dropped anywhere a Lucide
// icon is accepted (toolbar buttons, menu icons, nav rails, etc.).
export interface IconProps {
    size?: number
    color?: string
}

export type Icon = ComponentType<IconProps>

// makeIconFromPath turns a single 24x24 SVG path string into a
// Lucide-shaped icon component. The path is rendered with `fill=color`
// — designed for filled glyphs (Material-style), not stroked outlines.
// For multi-path icons or stroked icons, author a plain function
// component instead.
export function makeIconFromPath(d: string): Icon {
    return function IconFromPath({ size = 24, color }: IconProps) {
        return (
            <Svg width={size} height={size} viewBox="0 0 24 24">
                <Path d={d} fill={color} />
            </Svg>
        )
    }
}
