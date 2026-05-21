import { AlignJustify, RotateCcw, Rows3, WrapText } from 'lucide-react-native'
import type { ComponentType } from 'react'
import {
    IMAGE_WRAP_MODES,
    normalizeWrap,
    type WrapMode,
    wrapToAttr,
} from '../lib/image-wrap-modes'

// ImageWrapToolbar renders a row of four icon buttons above a selected
// image — one per wrap mode (inline / left / right / break). Mounts as
// a sibling of ImageResizeHandles inside the ImageNodeView wrapper so
// it shares the `selected && isEditable` gate; the wrapper is already
// position:relative so the absolute placement below works without any
// further CSS plumbing.
//
// The toolbar is web-only on purpose: the WebView editor on native
// renders bare <img>s (no NodeView), so there's nowhere to mount this
// chrome there. Native users can view wrap-moded images but not flip
// the mode — same asymmetry as the resize handles. See the package's
// help/image-wrap.md topic.
//
// Each button fires exactly one `updateAttributes({ wrap })` call with
// `null` for inline (so the attribute disappears entirely) or the
// literal mode name for the other three. The "modes are orthogonal"
// invariant — wrap doesn't touch width/height — is what makes the
// concurrent-resize race in §8 of the plan benign; don't be tempted to
// pass width/height alongside.

interface ImageWrapToolbarProps {
    wrap: string | null
    primaryColor: string
    mutedColor: string
    onChange: (next: WrapMode) => void
    // The rendered float side governs where the toolbar anchors: for
    // wrap='right' images we right-align so the toolbar doesn't get
    // pushed off-screen on narrow viewports.
    anchorRight: boolean
    // Reset-to-natural-size action. The parent NodeView reads the
    // <img>'s naturalWidth/naturalHeight and clamps to IMAGE_MAX_WIDTH
    // before calling onReset; the toolbar just renders the button. The
    // button dims (and the click is a no-op) when canReset is false —
    // either no explicit dimensions have been set yet (size already
    // tracks natural) or the natural dimensions aren't loadable.
    onReset: () => void
    canReset: boolean
}

// Lucide-react-native icons render fine on web (the package emits SVG
// via react-native-svg, which on react-native-web maps to plain SVG).
// We keep the ComponentType signature small so the icons array can be
// declared once and indexed by mode.
type IconComponent = ComponentType<{ size: number; color: string }>

const MODE_ICONS: Record<WrapMode, IconComponent> = {
    inline: AlignJustify,
    left: WrapText,
    // CSS scaleX(-1) on a wrapper around WrapText flips it horizontally;
    // we apply that transform at render time rather than picking a
    // second icon, so the two wrap-direction buttons stay visually paired.
    right: WrapText,
    break: Rows3,
}

const MODE_LABELS: Record<WrapMode, string> = {
    inline: 'Inline with text',
    left: 'Wrap text on the right',
    right: 'Wrap text on the left',
    break: 'Break line above and below',
}

export function ImageWrapToolbar({
    wrap,
    primaryColor,
    mutedColor,
    onChange,
    anchorRight,
    onReset,
    canReset,
}: ImageWrapToolbarProps) {
    const active = normalizeWrap(wrap)
    const positionStyle = anchorRight
        ? { right: 0, left: 'auto' as const }
        : { left: 0, right: 'auto' as const }
    return (
        <div
            // The toolbar sits 36px above the wrapper. The wrapper is
            // position:relative; with top:-36px we land just clear of
            // the selection outline (drawn at inset:0 on the same
            // wrapper). zIndex:3 keeps the toolbar above the outline
            // (which is zIndex:0/auto) and at par with the resize
            // handles (zIndex:2) — the handles never overlap with the
            // toolbar's row, so no z-fighting in practice.
            data-image-wrap-toolbar=""
            role="toolbar"
            aria-label="Image text wrap"
            style={{
                position: 'absolute',
                top: -36,
                ...positionStyle,
                display: 'flex',
                flexDirection: 'row',
                gap: 2,
                padding: 2,
                borderRadius: 4,
                backgroundColor: 'var(--editor-background, #fff)',
                border: `1px solid ${mutedColor}`,
                zIndex: 3,
                // The wrapper above us suppressed line-height to 0 to
                // collapse descender whitespace on the inline-block;
                // restore a normal line-height on the toolbar so the
                // icon row sits at its natural 24px.
                lineHeight: 1,
                // Whitespace inside the wrapper is set to "normal" by
                // NodeViewWrapper, but a parent paragraph could push a
                // pre-wrap context onto us — be explicit.
                whiteSpace: 'nowrap',
            }}
            // Don't steal focus from ProseMirror. The buttons inside
            // also preventDefault on mousedown for the same reason.
            onMouseDown={event => event.preventDefault()}
        >
            {IMAGE_WRAP_MODES.map(mode => (
                <WrapModeButton
                    key={mode}
                    mode={mode}
                    isActive={mode === active}
                    primaryColor={primaryColor}
                    mutedColor={mutedColor}
                    onPress={() => onChange(mode)}
                />
            ))}
            <ToolbarDivider color={mutedColor} />
            <ResetSizeButton
                onPress={onReset}
                disabled={!canReset}
                mutedColor={mutedColor}
            />
        </div>
    )
}

interface ToolbarDividerProps {
    color: string
}

function ToolbarDivider({ color }: ToolbarDividerProps) {
    // Vertical separator between the wrap-mode group and the reset
    // action. Same visual weight as the toolbar's border so the two
    // sections read as related-but-distinct surfaces.
    return (
        <span
            aria-hidden
            style={{
                display: 'inline-block',
                width: 1,
                alignSelf: 'stretch',
                marginInline: 2,
                backgroundColor: color,
                opacity: 0.4,
            }}
        />
    )
}

interface ResetSizeButtonProps {
    onPress: () => void
    disabled: boolean
    mutedColor: string
}

function ResetSizeButton({ onPress, disabled, mutedColor }: ResetSizeButtonProps) {
    const color = mutedColor
    return (
        <button
            type="button"
            data-image-wrap-reset=""
            aria-label="Reset image size"
            title="Reset image size"
            disabled={disabled}
            onMouseDown={event => event.preventDefault()}
            onClick={event => {
                event.preventDefault()
                event.stopPropagation()
                if (disabled) return
                onPress()
            }}
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 26,
                height: 26,
                padding: 0,
                border: 'none',
                borderRadius: 3,
                backgroundColor: 'transparent',
                cursor: disabled ? 'default' : 'pointer',
                color,
                // The button reads "available but inert" when the image
                // is already at its natural size — same affordance the
                // resize handles use when min-clamped.
                opacity: disabled ? 0.4 : 1,
            }}
        >
            <RotateCcw size={16} color={color} />
        </button>
    )
}

interface WrapModeButtonProps {
    mode: WrapMode
    isActive: boolean
    primaryColor: string
    mutedColor: string
    onPress: () => void
}

function WrapModeButton({
    mode,
    isActive,
    primaryColor,
    mutedColor,
    onPress,
}: WrapModeButtonProps) {
    const Icon = MODE_ICONS[mode]
    const label = MODE_LABELS[mode]
    const color = isActive ? primaryColor : mutedColor
    const backgroundColor = isActive ? `${primaryColor}22` : 'transparent'
    // wrap='right' shares the WrapText glyph with 'left'; flip the icon
    // horizontally so the two sit mirrored next to each other in the
    // toolbar. Pure CSS — the underlying SVG is unchanged.
    const iconTransform = mode === 'right' ? 'scaleX(-1)' : undefined
    return (
        <button
            type="button"
            data-image-wrap-mode={mode}
            aria-label={label}
            aria-pressed={isActive}
            title={label}
            onMouseDown={event => event.preventDefault()}
            onClick={event => {
                event.preventDefault()
                event.stopPropagation()
                onPress()
            }}
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 26,
                height: 26,
                padding: 0,
                border: 'none',
                borderRadius: 3,
                backgroundColor,
                cursor: 'pointer',
                color,
            }}
        >
            <span style={{ display: 'inline-flex', transform: iconTransform }}>
                <Icon size={16} color={color} />
            </span>
        </button>
    )
}

// Exported for ImageNodeView, which translates a WrapMode click into
// the persisted attribute value (null for 'inline'). Re-exported here
// rather than importing from lib/image-wrap-modes at the call site
// because everything wrap-mode-related now lives behind this file's
// surface.
export { wrapToAttr }
