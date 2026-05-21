import { useFileToken } from '@tinycld/core/file-viewer/use-authed-file-url'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { useRef, useState } from 'react'
import {
    clampImageSize,
    IMAGE_MAX_WIDTH,
    IMAGE_MIN_SIZE,
    type ResizeMode,
} from '../lib/image-resize'
import type { WrapMode } from '../lib/image-wrap-modes'
import { ImageWrapToolbar, wrapToAttr } from './ImageWrapToolbar.web'

// ImageNodeView replaces Tiptap's default Image DOM rendering so we can
// overlay drag-to-resize handles on the selected image. When the node
// is selected (Click on the image collapses the PM selection onto the
// image node), three handles appear:
//
//   - right edge midpoint — horizontal-only drag
//   - bottom edge midpoint — vertical-only drag
//   - bottom-right corner — preserves aspect ratio captured at
//     pointerdown via the underlying <img>'s naturalWidth/naturalHeight
//
// During a drag we update `liveSize` (React state) to drive the <img>
// inline style for smooth preview. Only the final size is committed
// via editor.commands.updateAttributes('image', ...) on pointerup so
// the Yjs/CRDT broker isn't flooded with hundreds of intermediate
// updates per drag.
//
// `lastSize` on the drag ref shadows `liveSize` for the commit path:
// React's state setter is async, and the closures originally attached
// to window via addEventListener captured the render-time `liveSize`
// (which is always `null` when startDrag fires). Reading the latest
// size off the ref sidesteps that stale-closure trap entirely.

interface DragState {
    mode: ResizeMode
    startX: number
    startY: number
    startWidth: number
    startHeight: number
    aspectRatio: number
    lastSize: { width: number; height: number } | null
}

// Appends a PocketBase file token to a tokenless drive-file URL so the
// browser can fetch the bytes of a protected drive_items image. Returns
// the src unchanged for data: URIs, non-drive URLs, URLs that already
// carry a token, or when no token is available yet.
function withFileToken(src: string, token: string | undefined): string {
    if (!token) return src
    if (!src.includes('/api/files/drive_items/')) return src
    if (src.includes('token=')) return src
    return `${src}${src.includes('?') ? '&' : '?'}token=${token}`
}

export function ImageNodeView(props: ReactNodeViewProps<HTMLSpanElement>) {
    const { node, updateAttributes, selected, editor } = props
    const primaryColor = useThemeColor('primary')
    const backgroundColor = useThemeColor('background')
    const mutedColor = useThemeColor('muted-foreground')

    const imgRef = useRef<HTMLImageElement | null>(null)
    const dragRef = useRef<DragState | null>(null)
    // liveSize drives the inline style while the user is mid-drag; null
    // means "fall back to the node's persisted width/height attrs".
    const [liveSize, setLiveSize] = useState<{ width: number; height: number } | null>(null)

    const src = (node.attrs.src as string | null) ?? ''
    // The stored src for an inserted image is a tokenless drive-file URL
    // (see buildInsertedImageURL). drive_items is protected, so the
    // browser <img> needs a short-lived ?token= to fetch the bytes. We
    // attach a fresh one here at render time; data: URIs (docx imports)
    // and already-tokened URLs pass through untouched.
    const { data: fileToken } = useFileToken()
    const displaySrc = withFileToken(src, fileToken)
    const alt = (node.attrs.alt as string | null) ?? ''
    const title = (node.attrs.title as string | null) ?? ''
    const wrap = (node.attrs.wrap as string | null) ?? null
    const attrWidth = (node.attrs.width as number | null) ?? null
    const attrHeight = (node.attrs.height as number | null) ?? null

    const displayWidth = liveSize?.width ?? attrWidth
    const displayHeight = liveSize?.height ?? attrHeight

    const isEditable = editor.isEditable

    function onPointerMove(event: PointerEvent) {
        const drag = dragRef.current
        if (!drag) return
        const dx = event.clientX - drag.startX
        const dy = event.clientY - drag.startY
        const next = clampImageSize({
            width: drag.startWidth + (drag.mode === 'vertical' ? 0 : dx),
            height: drag.startHeight + (drag.mode === 'horizontal' ? 0 : dy),
            aspectRatio: drag.aspectRatio,
            mode: drag.mode,
        })
        // Stash the latest computed size on the ref so onPointerUp can
        // read it without depending on React state (the stale closures
        // attached to window would otherwise see `liveSize === null`
        // and silently drop the commit).
        drag.lastSize = next
        setLiveSize(next)
    }

    function onPointerUp(_event: PointerEvent) {
        const drag = dragRef.current
        if (!drag) return
        dragRef.current = null
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onPointerUp)
        window.removeEventListener('pointercancel', onPointerUp)

        const final = drag.lastSize
        setLiveSize(null)
        if (!final) return
        // Defense-in-depth: re-clamp on commit. The pointermove handler
        // already clamps, but a future bug there would silently
        // persist out-of-bounds values into the Y.Doc.
        const committed = clampImageSize({
            width: final.width,
            height: final.height,
            aspectRatio: drag.aspectRatio,
            mode: drag.mode,
        })
        updateAttributes({ width: committed.width, height: committed.height })
    }

    function startDrag(mode: ResizeMode) {
        return (event: React.PointerEvent<HTMLDivElement>) => {
            if (!isEditable) return
            // Prevent ProseMirror from interpreting the pointerdown as
            // a selection drag — it would steal the pointer capture and
            // we'd lose subsequent move events.
            event.preventDefault()
            event.stopPropagation()
            const img = imgRef.current
            if (!img) return
            const rect = img.getBoundingClientRect()
            const naturalWidth = img.naturalWidth || rect.width
            const naturalHeight = img.naturalHeight || rect.height
            dragRef.current = {
                mode,
                startX: event.clientX,
                startY: event.clientY,
                startWidth: rect.width,
                startHeight: rect.height,
                aspectRatio: naturalHeight > 0 ? naturalWidth / naturalHeight : 1,
                lastSize: null,
            }
            window.addEventListener('pointermove', onPointerMove)
            window.addEventListener('pointerup', onPointerUp)
            window.addEventListener('pointercancel', onPointerUp)
        }
    }

    // The wrapper carries `data-wrap` (not the inner <img>) because the
    // NodeView adds two non-floating spans between the paragraph and
    // the img. Floating the img directly would no longer push text
    // around the wrapper. Sizing the wrapper to the committed pixel
    // dimensions (rather than letting it fit-to-content) keeps the
    // selection outline + drag handles in lockstep with whatever the
    // <img> renders at — and it gives the float a deterministic box
    // when wrapped CSS would otherwise also re-apply max-width.
    //
    // Break mode is the odd one out: it needs `display: block` so the
    // following text drops to a new line, not `inline-block` (which
    // lets text sit beside the wrapper's bottom edge). We set display
    // inline here rather than in CSS because an inline `style` wins
    // over the stylesheet's [data-wrap='break'] { display: block }
    // rule — the rule alone never takes effect.
    const isBreakMode = wrap === 'break'
    const wrapperStyle = {
        position: 'relative' as const,
        display: isBreakMode ? 'block' : 'inline-block',
        // Suppress the half-line of descender space the inline-block
        // wrapper would otherwise add below the img. In break mode the
        // wrapper is a block on its own line, so the descender gap
        // doesn't apply.
        lineHeight: 0,
        ...(displayWidth ? { width: `${displayWidth}px` } : {}),
        ...(displayHeight ? { height: `${displayHeight}px` } : {}),
    }

    // When the wrapper has explicit pixel dimensions (from the resize
    // attrs or the DOCX import), the img stretches to fill it — that
    // keeps the rendered image in lockstep with the selection outline
    // and the drag handles even if the stylesheet would otherwise have
    // imposed a `max-width` on the img. When dimensions are absent
    // (freshly inserted image with no width/height attrs yet), leave
    // the img at its intrinsic size so the wrapper can sizes-to-content.
    const hasExplicitSize = displayWidth !== null && displayHeight !== null
    const imgStyle = {
        display: 'block' as const,
        ...(hasExplicitSize ? { width: '100%', height: '100%' } : {}),
    }

    const showHandles = selected && isEditable

    function onWrapChange(next: WrapMode) {
        // Only send the wrap attr — never bundle width/height in here.
        // The "modes are orthogonal" invariant in §8 of the plan is
        // what makes a concurrent resize on another client benign:
        // wrap and dimensions live on different keys of the same Y.Map
        // and don't collide.
        updateAttributes({ wrap: wrapToAttr(next) })
    }

    // Read the underlying <img>'s natural dimensions and clamp them to
    // the editor's max width while preserving aspect ratio. naturalWidth
    // is 0 until the image bytes load (and our drive_items URLs always
    // resolve, but a freshly-pasted data URI can race). canReset gates
    // the toolbar button so the user doesn't get a no-op click.
    function getNaturalSize(): { width: number; height: number } | null {
        const img = imgRef.current
        if (!img) return null
        const naturalWidth = img.naturalWidth
        const naturalHeight = img.naturalHeight
        if (naturalWidth <= 0 || naturalHeight <= 0) return null
        const aspectRatio = naturalWidth / naturalHeight
        // Reuse the corner-drag clamp so the reset path can't produce
        // a width/height pair the resize path would reject. Mode is
        // 'corner' because we want both axes scaled together if the
        // natural width exceeds IMAGE_MAX_WIDTH.
        return clampImageSize({
            width: naturalWidth,
            height: naturalHeight,
            aspectRatio,
            mode: 'corner',
        })
    }

    function onResetSize() {
        const natural = getNaturalSize()
        if (!natural) return
        // Orthogonal to wrap (same invariant as onWrapChange) — only
        // touch dimension keys, never bundle a wrap update.
        updateAttributes({ width: natural.width, height: natural.height })
    }

    // canReset is false when either the natural dimensions aren't
    // readable yet OR the current displayed dimensions already match
    // them (within 1 px of integer rounding). The toolbar dims the
    // button in that state so the user sees there's nothing to undo.
    const natural = getNaturalSize()
    const canReset =
        natural !== null &&
        (displayWidth === null ||
            displayHeight === null ||
            Math.abs(displayWidth - natural.width) > 1 ||
            Math.abs(displayHeight - natural.height) > 1)

    return (
        <NodeViewWrapper as="span" style={wrapperStyle} data-wrap={wrap ?? undefined}>
            <img
                ref={imgRef}
                src={displaySrc}
                alt={alt || undefined}
                title={title || undefined}
                style={imgStyle}
                width={displayWidth ?? undefined}
                height={displayHeight ?? undefined}
                draggable={false}
            />
            {showHandles ? (
                <>
                    <ImageWrapToolbar
                        wrap={wrap}
                        primaryColor={primaryColor}
                        mutedColor={mutedColor}
                        onChange={onWrapChange}
                        anchorRight={wrap === 'right'}
                        onReset={onResetSize}
                        canReset={canReset}
                    />
                    <ImageResizeHandles
                        primaryColor={primaryColor}
                        backgroundColor={backgroundColor}
                        startDrag={startDrag}
                        width={displayWidth}
                        height={displayHeight}
                    />
                </>
            ) : null}
        </NodeViewWrapper>
    )
}

interface ImageResizeHandlesProps {
    primaryColor: string
    backgroundColor: string
    startDrag: (mode: ResizeMode) => (event: React.PointerEvent<HTMLDivElement>) => void
    width: number | null
    height: number | null
}

function ImageResizeHandles({
    primaryColor,
    backgroundColor,
    startDrag,
    width,
    height,
}: ImageResizeHandlesProps) {
    const handleBase = {
        position: 'absolute' as const,
        width: 10,
        height: 10,
        backgroundColor: primaryColor,
        // The halo around each handle is the page background, which
        // gives correct contrast against the primary-tinted fill in
        // both light and dark themes.
        border: `1px solid ${backgroundColor}`,
        borderRadius: 2,
        boxSizing: 'border-box' as const,
        zIndex: 2,
    }
    const outlineStyle = {
        position: 'absolute' as const,
        inset: 0,
        outline: `1px solid ${primaryColor}`,
        outlineOffset: -1,
        pointerEvents: 'none' as const,
    }
    const widthValue = width ?? 0
    const heightValue = height ?? 0
    return (
        <>
            <div aria-hidden style={outlineStyle} />
            <div
                role="slider"
                tabIndex={0}
                aria-label="Resize image width"
                aria-valuenow={widthValue}
                aria-valuemin={IMAGE_MIN_SIZE}
                aria-valuemax={IMAGE_MAX_WIDTH}
                data-image-handle="right"
                onPointerDown={startDrag('horizontal')}
                style={{
                    ...handleBase,
                    right: -5,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    cursor: 'ew-resize',
                }}
            />
            <div
                role="slider"
                tabIndex={0}
                aria-label="Resize image height"
                aria-valuenow={heightValue}
                aria-valuemin={IMAGE_MIN_SIZE}
                aria-valuemax={IMAGE_MAX_WIDTH * 4}
                data-image-handle="bottom"
                onPointerDown={startDrag('vertical')}
                style={{
                    ...handleBase,
                    bottom: -5,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    cursor: 'ns-resize',
                }}
            />
            <div
                role="slider"
                tabIndex={0}
                aria-label="Resize image"
                aria-valuenow={widthValue}
                aria-valuemin={IMAGE_MIN_SIZE}
                aria-valuemax={IMAGE_MAX_WIDTH}
                data-image-handle="corner"
                onPointerDown={startDrag('corner')}
                style={{
                    ...handleBase,
                    right: -5,
                    bottom: -5,
                    cursor: 'nwse-resize',
                }}
            />
        </>
    )
}
