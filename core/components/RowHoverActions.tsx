import type { ReactNode } from 'react'
import { Pressable, View } from 'react-native'

interface RowHoverActionsProps {
    /** Whether the row is currently hovered (web-only behavior). */
    isHovered: boolean
    /** Static affordance shown when the row is not hovered (e.g. a star icon). */
    rest: ReactNode
    /** Action icons shown on hover, absolutely positioned over `rest`. */
    hover: ReactNode
    /** Width of the trailing column. Pick the larger of `rest` and `hover` so
     *  neither state clips. Default 96 fits ~3 HoverAction icons. */
    width?: number
    /** Background color used to mask the row underneath the absolute hover
     *  layer. Defaults to transparent so the row's own background (which
     *  changes for selected / hovered states) shows through. Pass an
     *  explicit color only when the static `rest` content would otherwise
     *  visually bleed through the hover icons. */
    backgroundColor?: string
}

/**
 * Trailing column for list rows that swap a static affordance for a set of
 * hover actions on web hover, without shifting the row's other columns.
 *
 * Layout: a fixed-width box that contains the static `rest` node in flow and
 * the `hover` node absolutely positioned over the same box. Both sides are
 * always mounted; opacity + pointerEvents toggle on hover. This keeps the row
 * width stable regardless of how many icons each side has.
 *
 * The hover layer paints with a transparent default mask. `rest` is set to
 * opacity 0 when hovered, so there's nothing visible to cover; letting the
 * row's own background show through keeps the icons aligned with selected /
 * hover-tinted row states (a hard-coded background-color mask broke out of
 * those states with a white pill).
 *
 * Native: there is no hover, so `hover` stays hidden and `rest` is shown.
 * Tap handling (e.g. tapping a static star to toggle favourite) belongs in
 * `rest` itself.
 */
export function RowHoverActions({
    isHovered,
    rest,
    hover,
    width = 96,
    backgroundColor = 'transparent',
}: RowHoverActionsProps) {
    return (
        <View
            className="items-end justify-center"
            style={{
                width,
                flexShrink: 0,
                position: 'relative',
            }}
        >
            <View style={isHovered ? { opacity: 0, pointerEvents: 'none' } : undefined}>
                {rest}
            </View>
            <Pressable
                style={{
                    position: 'absolute',
                    right: 0,
                    top: 0,
                    bottom: 0,
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor,
                    ...(isHovered ? {} : { opacity: 0, pointerEvents: 'none' as const }),
                }}
                onPress={e => e.stopPropagation()}
            >
                {hover}
            </Pressable>
        </View>
    )
}
