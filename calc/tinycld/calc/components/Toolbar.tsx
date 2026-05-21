import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import {
    ArrowLeft,
    ArrowRight,
    Bold,
    DollarSign,
    Italic,
    Percent,
    Redo,
    Search,
    Strikethrough,
    Underline,
    Undo,
} from 'lucide-react-native'
import { memo } from 'react'
import { Text, View } from 'react-native'
import type * as Y from 'yjs'
import type { HorizontalAlign } from '../hooks/grid/use-grid-format-controls'
import type { BorderPresetId } from '../lib/border-presets'
import type { CellBorders } from '../lib/workbook-types'
import { PivotInsertButton } from './pivot/PivotInsertButton'
import { BordersMenu } from './toolbar/BordersMenu'
import { FillColorMenu } from './toolbar/FillColorMenu'
import { FontSizeStepper } from './toolbar/FontSizeStepper'
import { HorizontalAlignMenu } from './toolbar/HorizontalAlignMenu'
import { NumberFormatMenu } from './toolbar/NumberFormatMenu'
import { TextColorMenu } from './toolbar/TextColorMenu'
import { ToolbarButton, ToolbarDivider } from './toolbar/ToolbarButton'

export interface ToolbarProps {
    // Selection-based disable for the formatting buttons. Undo/Redo
    // ignore this — you can undo without a selected cell.
    disabled: boolean

    canUndo: boolean
    canRedo: boolean
    onUndo: () => void
    onRedo: () => void

    isBold: boolean
    isItalic: boolean
    isUnderline: boolean
    isStrike: boolean
    onToggleBold: () => void
    onToggleItalic: () => void
    onToggleUnderline: () => void
    onToggleStrike: () => void

    currentNumFmt: string | undefined
    onApplyPreset: (id: string) => void
    onApplyCurrency: () => void
    onApplyPercent: () => void
    onDecreaseDecimal: () => void
    onIncreaseDecimal: () => void

    fontSize: number | undefined
    onSetFontSize: (size: number) => void

    fontColor: string | undefined
    onSetFontColor: (color: string) => void

    fillColor: string | undefined
    onSetFillColor: (color: string) => void

    borders: CellBorders | undefined
    onSetBorders: (presetId: BorderPresetId) => void

    horizontalAlign: HorizontalAlign | undefined
    onSetHorizontalAlign: (align: HorizontalAlign) => void

    onOpenFind: () => void

    onDownloadCsvCurrent: () => void
    onDownloadCsvAll: () => void
    onDownloadXlsx?: () => void

    onOpenPrint: () => void

    // Sort opens the modal SortDialog. Filter toggles the filter view
    // on the active selection (creates if none, removes if present).
    onOpenSort: () => void
    onToggleFilter: () => void
    isFilterActive: boolean

    onMergeAll: () => void
    onMergeHorizontal: () => void
    onMergeVertical: () => void
    onUnmerge: () => void

    frozenRows: number
    frozenCols: number
    selectionBottomRow: number | null
    selectionRightCol: number | null
    onSetFrozenRows: (n: number) => void
    onSetFrozenCols: (n: number) => void
    onUnfreeze: () => void

    // Pivot table insert. `doc` is null while the realtime room is
    // still handshaking; the button stays disabled until the doc
    // arrives. The defaults pre-fill the new-pivot dialog with the
    // current selection / active sheet name; onPivotSheetActivated
    // switches the workbook to the freshly-created output sheet.
    doc: Y.Doc | null
    pivotSourceRangeDefault: string
    pivotTargetSheetNameDefault: string
    onPivotSheetActivated: (sheetId: string) => void
}

// memo'd so that selection-range churn during a drag (which only
// affects the Grid body's range tint and overlays) doesn't re-render
// the entire toolbar subtree of menus, color pickers, and font
// stepper. All ToolbarProps callbacks must be stable references —
// see Grid.tsx where the inline arrows are wrapped in useCallback.
export const Toolbar = memo(ToolbarImpl)

function ToolbarImpl(props: ToolbarProps) {
    const {
        disabled,
        canUndo,
        canRedo,
        onUndo,
        onRedo,
        isBold,
        isItalic,
        isUnderline,
        isStrike,
        onToggleBold,
        onToggleItalic,
        onToggleUnderline,
        onToggleStrike,
        currentNumFmt,
        onApplyPreset,
        onApplyCurrency,
        onApplyPercent,
        onDecreaseDecimal,
        onIncreaseDecimal,
        fontSize,
        onSetFontSize,
        fontColor,
        onSetFontColor,
        fillColor,
        onSetFillColor,
        borders,
        onSetBorders,
        horizontalAlign,
        onSetHorizontalAlign,
        onOpenFind,
        doc,
        pivotSourceRangeDefault,
        pivotTargetSheetNameDefault,
        onPivotSheetActivated,
    } = props

    return (
        <View
            className="flex-row items-center bg-surface-secondary border-b border-border overflow-visible"
            style={{ height: 32, paddingHorizontal: 4 }}
            {...(typeof document !== 'undefined' ? { 'data-test-id': 'calc-toolbar' } : {})}
        >
            <ToolbarButton icon={Undo} disabled={!canUndo} onPress={onUndo} label="Undo" />
            <ToolbarButton icon={Redo} disabled={!canRedo} onPress={onRedo} label="Redo" />
            <ToolbarDivider />

            <NumberFormatMenu
                currentNumFmt={currentNumFmt}
                disabled={disabled}
                onApplyPreset={onApplyPreset}
            />
            <ToolbarButton
                icon={DollarSign}
                disabled={disabled}
                onPress={onApplyCurrency}
                label="Format as currency"
            />
            <ToolbarButton
                icon={Percent}
                disabled={disabled}
                onPress={onApplyPercent}
                label="Format as percent"
            />
            <ToolbarButton
                disabled={disabled}
                onPress={onDecreaseDecimal}
                label="Decrease decimal places"
                width={32}
            >
                <DecimalIcon direction="decrease" />
            </ToolbarButton>
            <ToolbarButton
                disabled={disabled}
                onPress={onIncreaseDecimal}
                label="Increase decimal places"
                width={32}
            >
                <DecimalIcon direction="increase" />
            </ToolbarButton>
            <ToolbarDivider />

            <FontSizeStepper size={fontSize} disabled={disabled} onSetSize={onSetFontSize} />
            <ToolbarDivider />

            <ToolbarButton
                icon={Bold}
                active={isBold}
                disabled={disabled}
                onPress={onToggleBold}
                label="Bold"
            />
            <ToolbarButton
                icon={Italic}
                active={isItalic}
                disabled={disabled}
                onPress={onToggleItalic}
                label="Italic"
            />
            <ToolbarButton
                icon={Underline}
                active={isUnderline}
                disabled={disabled}
                onPress={onToggleUnderline}
                label="Underline"
            />
            <ToolbarButton
                icon={Strikethrough}
                active={isStrike}
                disabled={disabled}
                onPress={onToggleStrike}
                label="Strikethrough"
            />
            <TextColorMenu color={fontColor} disabled={disabled} onSetColor={onSetFontColor} />
            <FillColorMenu color={fillColor} disabled={disabled} onSetColor={onSetFillColor} />
            <BordersMenu borders={borders} disabled={disabled} onSetBorders={onSetBorders} />
            <ToolbarDivider />

            <HorizontalAlignMenu
                align={horizontalAlign}
                disabled={disabled}
                onSetAlign={onSetHorizontalAlign}
            />
            <ToolbarDivider />

            <ToolbarButton icon={Search} onPress={onOpenFind} label="Find and replace" />
            <ToolbarDivider />

            <PivotInsertButton
                doc={doc}
                defaultSourceRange={pivotSourceRangeDefault}
                defaultTargetSheetName={pivotTargetSheetNameDefault}
                onActivateSheet={onPivotSheetActivated}
            />
        </View>
    )
}

// DecimalIcon is a lightweight composition: ".0" text plus a left or
// right arrow. Lucide doesn't ship the Google-Sheets-style "decrease /
// increase decimal" glyph, and pulling in react-native-svg just for
// this would be heavier than a Text + arrow stack.
function DecimalIcon({ direction }: { direction: 'increase' | 'decrease' }) {
    const fg = useThemeColor('foreground')
    const Arrow = direction === 'increase' ? ArrowRight : ArrowLeft
    return (
        <View className="flex-row items-center" style={{ gap: 1 }}>
            <Text style={{ fontSize: 11, fontFamily: 'monospace', color: fg }}>.0</Text>
            <Arrow size={10} color={fg} />
        </View>
    )
}
