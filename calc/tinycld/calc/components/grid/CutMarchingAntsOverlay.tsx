import { useEffect } from 'react'
import { Platform, View } from 'react-native'
import { useGridStore } from '../../hooks/use-grid-store'

// Paints the "marching ants" outline around the cut/copy source range
// so the user can see what they've staged for paste. Active whenever
// the grid store carries a copySourceRange (set by both copy and cut;
// cut additionally sets cutPending which the paste action consumes to
// clear the source cells).
//
// Visual implementation differs by platform:
//   - Web: an animated CSS gradient on a 2px-thick outer ring fakes
//     the classic Excel/Sheets marching-ants effect. The `<style>`
//     tag is injected once per process and reuses the same keyframe
//     for every overlay instance.
//   - Native: a static 2px dashed border. Animation infrastructure
//     for native is more involved (Reanimated + per-side Animated
//     Views) and the v1 use case for cut/paste on touch devices is
//     rare enough that we ship without it.

const ANTS_STYLE_ID = 'tinycld-calc-ants-keyframes'

interface CutMarchingAntsOverlayProps {
    colOffsets: Float64Array
    rowOffsets: Float64Array
}

export function CutMarchingAntsOverlay({ colOffsets, rowOffsets }: CutMarchingAntsOverlayProps) {
    // Inject the @keyframes block on web exactly once. Subsequent
    // mounts find the existing <style> and skip the insert.
    useEffect(() => {
        if (Platform.OS !== 'web') return
        if (document.getElementById(ANTS_STYLE_ID) != null) return
        const style = document.createElement('style')
        style.id = ANTS_STYLE_ID
        // The "ants" effect = a diagonal striped background-image whose
        // background-position animates by one tile width. The result
        // is the dashed outline appearing to march counter-clockwise
        // around the perimeter.
        style.textContent = `
@keyframes tinycld-calc-ants {
    from { background-position: 0 0, 8px 100%, 100% 8px, 0 0; }
    to { background-position: 8px 0, 0 100%, 100% 0, 0 8px; }
}
.tinycld-calc-ants {
    position: absolute;
    pointer-events: none;
    background-image:
        linear-gradient(90deg, #1a8757 50%, transparent 50%),
        linear-gradient(90deg, #1a8757 50%, transparent 50%),
        linear-gradient(0deg, #1a8757 50%, transparent 50%),
        linear-gradient(0deg, #1a8757 50%, transparent 50%);
    background-size: 8px 2px, 8px 2px, 2px 8px, 2px 8px;
    background-position: 0 0, 0 100%, 0 0, 100% 0;
    background-repeat: repeat-x, repeat-x, repeat-y, repeat-y;
    animation: tinycld-calc-ants 0.6s linear infinite;
}
`
        document.head.appendChild(style)
    }, [])

    const range = useGridStore(s => s.copySourceRange)
    if (range == null) return null

    const left = colOffsets[range.startCol - 1] ?? 0
    const right = colOffsets[range.endCol] ?? left
    const width = right - left
    if (width <= 0) return null
    const top = rowOffsets[range.startRow - 1] ?? 0
    const bottom = rowOffsets[range.endRow] ?? top
    const height = bottom - top
    if (height <= 0) return null

    if (Platform.OS === 'web') {
        // Cast as unknown to attach a DOM className to RN-Web's View
        // (which forwards unknown props through to the underlying div).
        const webProps = { className: 'tinycld-calc-ants' } as unknown as Record<string, unknown>
        return (
            <View
                {...webProps}
                pointerEvents="none"
                style={{ position: 'absolute', left, top, width, height }}
            />
        )
    }

    // Native fallback: static dashed border. The dashed style on RN
    // is supported per-platform but the dash pattern is not
    // animatable without a Reanimated worklet, which is overkill for
    // a v1 cue.
    return (
        <View
            pointerEvents="none"
            style={{
                position: 'absolute',
                left,
                top,
                width,
                height,
                borderWidth: 2,
                borderStyle: 'dashed',
                borderColor: '#1a8757',
            }}
        />
    )
}
