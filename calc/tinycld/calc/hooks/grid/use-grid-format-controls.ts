import { LOCAL_ORIGIN } from '@tinycld/core/lib/realtime/client'
import { useCallback } from 'react'
import type * as Y from 'yjs'
import { applyStyleToRange } from '../../components/grid/style-helpers'
import { applyBorderPreset, type BorderPresetId } from '../../lib/border-presets'
import { stepDecimals } from '../../lib/number-format/decimal-step'
import { findPresetById } from '../../lib/number-format/presets'
import { allRanges } from '../../lib/selection-range'
import type { CellAlignment, CellBorders } from '../../lib/workbook-types'
import type { CellRange } from '../grid-store'
import { useBordersPickerStore } from '../use-borders-picker-store'
import { useGridStoreApi } from '../use-grid-store'
import type { useYCell } from '../use-y-cell'

export type HorizontalAlign = NonNullable<CellAlignment['horizontal']>

// GridFormatControls bundles the toolbar-side write paths for number
// formatting, font sizing, font/fill color, borders, and alignment.
//
// Read state (the current cell's numFmt / size / color / etc.) is
// derived from the `selectedCellValue` that `useGridToolbarToggles`
// already subscribes to — passing it in here avoids a second useYCell
// observer for the same cell.
//
// All write paths route through applyStyleToRange so that when a
// multi-cell selection is active the same patch lands on every cell
// in the range inside a single yjs transaction (one undo step).
//
// Importantly, this hook does NOT subscribe to selectionRange. Each
// drag-move produces a new range object; a subscriber would re-run
// every move, churning the prop identities of all 14+ <Toolbar>
// inputs and forcing the whole toolbar subtree (menus, color
// pickers, font stepper) to re-render. Write callbacks instead read
// the live range via store.getState() at call time. Read state still
// reflects the anchor cell — toolbar indicators (isBold, fontSize)
// match the visibly-outlined "primary" cell.
export interface GridFormatControls {
    currentNumFmt: string | undefined
    fontSize: number | undefined
    fontColor: string | undefined
    fillColor: string | undefined
    borders: CellBorders | undefined
    horizontalAlign: HorizontalAlign | undefined
    applyPreset: (id: string) => void
    applyNumFmt: (numFmt: string) => void
    stepDecimal: (delta: 1 | -1) => void
    // Pre-bound shortcuts for the toolbar's currency / percent / decimal
    // buttons. Identities are stable across renders so memo'd Toolbar
    // doesn't churn.
    applyCurrency: () => void
    applyPercent: () => void
    decreaseDecimal: () => void
    increaseDecimal: () => void
    setFontSize: (size: number) => void
    setFontColor: (color: string) => void
    setFillColor: (color: string) => void
    setBorders: (presetId: BorderPresetId) => void
    setHorizontalAlign: (align: HorizontalAlign) => void
}

interface UseGridFormatControlsArgs {
    doc: Y.Doc | null
    sheetId: string
    readOnly: boolean
    selectedCellValue: ReturnType<typeof useYCell>
}

export function useGridFormatControls({
    doc,
    sheetId,
    readOnly,
    selectedCellValue,
}: UseGridFormatControlsArgs): GridFormatControls {
    const currentNumFmt = selectedCellValue?.style?.numFmt
    const fontSize = selectedCellValue?.style?.font?.size
    const fontColor = selectedCellValue?.style?.font?.color
    const fillColor =
        selectedCellValue?.style?.fill?.fgColor ?? selectedCellValue?.style?.fill?.bgColor
    const borders = selectedCellValue?.style?.borders
    const horizontalAlign = selectedCellValue?.style?.alignment?.horizontal

    const store = useGridStoreApi()

    // Resolves every sub-range's rectangle from the store at call
    // time. Returns [] when there's no selection — callers early-
    // return. On a single-rectangle selection the array has one
    // entry (N=1 case); on a disjoint selection it has every sub-
    // range's `range` (plan Tier A — apply the patch to all).
    const resolveRanges = useCallback((): CellRange[] => {
        return allRanges(store.getState().selection)
    }, [store])

    // applyToRanges wraps N applyStyleToRange calls in a single
    // doc.transact so a disjoint write is one undo step. The wrapped
    // operation matches the original behavior when N=1.
    const applyToRanges = useCallback(
        (ranges: CellRange[], apply: (range: CellRange) => void) => {
            if (doc == null) return
            doc.transact(() => {
                for (const range of ranges) {
                    apply(range)
                }
            }, LOCAL_ORIGIN)
        },
        [doc]
    )

    const writeNumFmt = useCallback(
        (numFmt: string | undefined) => {
            if (readOnly || doc == null) return
            const ranges = resolveRanges()
            if (ranges.length === 0) return
            // setYCellStyle skips undefined values; pass an empty string to
            // explicitly clear a previously-applied numFmt (matches the
            // "Automatic" preset's null pattern semantics elsewhere).
            const value = numFmt ?? ''
            applyToRanges(ranges, range =>
                applyStyleToRange(doc, sheetId, range, { numFmt: value })
            )
        },
        [doc, sheetId, resolveRanges, applyToRanges, readOnly]
    )

    const applyPreset = useCallback(
        (id: string) => {
            const preset = findPresetById(id)
            if (preset == null) return
            // Automatic preset (numFmt: null) maps to clearing the
            // pattern. writeNumFmt translates undefined → empty string.
            writeNumFmt(preset.numFmt ?? undefined)
        },
        [writeNumFmt]
    )

    const applyNumFmt = useCallback(
        (numFmt: string) => {
            writeNumFmt(numFmt)
        },
        [writeNumFmt]
    )

    const stepDecimal = useCallback(
        (delta: 1 | -1) => {
            const next = stepDecimals(currentNumFmt, delta)
            if (next === currentNumFmt) return
            writeNumFmt(next)
        },
        [currentNumFmt, writeNumFmt]
    )

    const applyCurrency = useCallback(() => applyPreset('currency'), [applyPreset])
    const applyPercent = useCallback(() => applyPreset('percent'), [applyPreset])
    const decreaseDecimal = useCallback(() => stepDecimal(-1), [stepDecimal])
    const increaseDecimal = useCallback(() => stepDecimal(1), [stepDecimal])

    const setFontSize = useCallback(
        (size: number) => {
            if (readOnly || doc == null) return
            if (!Number.isFinite(size)) return
            const ranges = resolveRanges()
            if (ranges.length === 0) return
            const clamped = Math.max(6, Math.min(96, Math.round(size)))
            applyToRanges(ranges, range =>
                applyStyleToRange(doc, sheetId, range, { font: { size: clamped } })
            )
        },
        [doc, sheetId, resolveRanges, applyToRanges, readOnly]
    )

    const setFontColor = useCallback(
        (color: string) => {
            if (readOnly || doc == null) return
            const ranges = resolveRanges()
            if (ranges.length === 0) return
            applyToRanges(ranges, range =>
                applyStyleToRange(doc, sheetId, range, { font: { color } })
            )
        },
        [doc, sheetId, resolveRanges, applyToRanges, readOnly]
    )

    const setFillColor = useCallback(
        (color: string) => {
            if (readOnly || doc == null) return
            const ranges = resolveRanges()
            if (ranges.length === 0) return
            // Write fgColor as the canonical fill — the render path
            // also reads bgColor as a fallback, so we don't need to
            // touch both.
            applyToRanges(ranges, range =>
                applyStyleToRange(doc, sheetId, range, { fill: { fgColor: color } })
            )
        },
        [doc, sheetId, resolveRanges, applyToRanges, readOnly]
    )

    const setBorders = useCallback(
        (presetId: BorderPresetId) => {
            if (readOnly || doc == null) return
            const ranges = resolveRanges()
            if (ranges.length === 0) return
            // Read the picker's sticky color + line style at write time
            // so each pattern click reflects the most recent sub-picker
            // selection — matching the Google Sheets / Excel UX where
            // the color picker pre-arms the next paint.
            const { color, style } = useBordersPickerStore.getState()
            const edge = { style, color }
            // applyBorderPreset already wraps its writes in a transact.
            // Nested transacts on the same doc + same origin are
            // flattened by yjs, so wrapping our outer loop here keeps
            // the disjoint write as a single undo step.
            applyToRanges(ranges, range =>
                applyBorderPreset(doc, sheetId, range, presetId, edge)
            )
        },
        [doc, sheetId, resolveRanges, applyToRanges, readOnly]
    )

    const setHorizontalAlign = useCallback(
        (align: HorizontalAlign) => {
            if (readOnly || doc == null) return
            const ranges = resolveRanges()
            if (ranges.length === 0) return
            applyToRanges(ranges, range =>
                applyStyleToRange(doc, sheetId, range, { alignment: { horizontal: align } })
            )
        },
        [doc, sheetId, resolveRanges, applyToRanges, readOnly]
    )

    return {
        currentNumFmt,
        fontSize,
        fontColor,
        fillColor,
        borders,
        horizontalAlign,
        applyPreset,
        applyNumFmt,
        stepDecimal,
        applyCurrency,
        applyPercent,
        decreaseDecimal,
        increaseDecimal,
        setFontSize,
        setFontColor,
        setFillColor,
        setBorders,
        setHorizontalAlign,
    }
}
