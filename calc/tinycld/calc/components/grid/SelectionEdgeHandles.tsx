// Four corner handles on the active selection's bounding rect. Native-
// only — iPad users have no shift+click / shift+arrow to grow a
// selection, so the visible handles give them explicit drag targets on
// each corner. Dragging a corner extends the active sub-range to
// whichever cell the finger reaches.
//
// Delta-based drag math (same trick as SelectionHandleOverlay): we
// remember the pointer's pageX/pageY at down-time and add the pointer
// displacement since then to the handle's known grid coord at gesture
// start. That gives the pointer's current grid coord without ever
// needing measureInWindow on the handle View.

import { useDragGesture } from '@tinycld/core/lib/gestures'
import { useRef } from 'react'
import { Platform, View } from 'react-native'
import { useGridStore, useGridStoreApi } from '../../hooks/use-grid-store'
import { primaryRange } from '../../lib/selection-range'
import { computeHandlePositions } from './selection-edge-handles-math'
import { locateCellAtGridCoord } from './style-helpers'

export { computeHandlePositions } from './selection-edge-handles-math'
export type { HandlePositions } from './selection-edge-handles-math'

interface SelectionEdgeHandlesProps {
    colOffsets: Float64Array
    rowOffsets: Float64Array
    readOnly: boolean
}

export function SelectionEdgeHandles({
    colOffsets,
    rowOffsets,
    readOnly,
}: SelectionEdgeHandlesProps) {
    // Hide while editing — the corner dots would visually fight the
    // cell editor's caret and border. Mirrors SelectionHandleOverlay.
    const selection = useGridStore(s => (s.editSession == null ? s.selection : null))
    const store = useGridStoreApi()
    const range = primaryRange(selection)
    const positions = computeHandlePositions(range, colOffsets, rowOffsets)

    // Web users already have shift+click / shift+arrow to grow a
    // selection; the handles would be redundant and clutter the UI.
    if (Platform.OS === 'web') return null
    if (readOnly) return null
    if (positions == null) return null

    return (
        <>
            <Handle
                x={positions.left}
                y={positions.top}
                colOffsets={colOffsets}
                rowOffsets={rowOffsets}
                store={store}
            />
            <Handle
                x={positions.right}
                y={positions.top}
                colOffsets={colOffsets}
                rowOffsets={rowOffsets}
                store={store}
            />
            <Handle
                x={positions.left}
                y={positions.bottom}
                colOffsets={colOffsets}
                rowOffsets={rowOffsets}
                store={store}
            />
            <Handle
                x={positions.right}
                y={positions.bottom}
                colOffsets={colOffsets}
                rowOffsets={rowOffsets}
                store={store}
            />
        </>
    )
}

interface HandleProps {
    x: number
    y: number
    colOffsets: Float64Array
    rowOffsets: Float64Array
    store: ReturnType<typeof useGridStoreApi>
}

const HANDLE_SIZE = 16
const HANDLE_HIT_SLOP = 8

function Handle({ x, y, colOffsets, rowOffsets, store }: HandleProps) {
    // Captured at down-time so onDragMove can compute the pointer's
    // grid coord as (corner-grid-coord) + (pointer-displacement-since-
    // start). No measureInWindow needed — the delta is frame-agnostic.
    const startPointerX = useRef(0)
    const startPointerY = useRef(0)

    const drag = useDragGesture({
        onDragStart: ctx => {
            startPointerX.current = ctx.pointer.x
            startPointerY.current = ctx.pointer.y
            return true
        },
        onDragMove: ctx => {
            const gridX = x + (ctx.pointer.x - startPointerX.current)
            const gridY = y + (ctx.pointer.y - startPointerY.current)
            const target = locateCellAtGridCoord(gridX, gridY, colOffsets, rowOffsets)
            if (target == null) return
            store.getState().extendActiveRangeTo(target)
        },
    })

    return (
        <View
            style={{
                position: 'absolute',
                left: x - HANDLE_SIZE / 2,
                top: y - HANDLE_SIZE / 2,
                width: HANDLE_SIZE,
                height: HANDLE_SIZE,
                borderRadius: HANDLE_SIZE / 2,
                backgroundColor: '#22a06b',
                borderWidth: 2,
                borderColor: '#ffffff',
            }}
            hitSlop={{
                top: HANDLE_HIT_SLOP,
                bottom: HANDLE_HIT_SLOP,
                left: HANDLE_HIT_SLOP,
                right: HANDLE_HIT_SLOP,
            }}
            {...drag.handlers}
        />
    )
}
