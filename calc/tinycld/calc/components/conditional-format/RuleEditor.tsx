// One-rule authoring form. Owns local draft state for the rule the
// user is currently editing (controlled by the parent's editingRuleId
// keying — when the key changes, this remounts with a fresh draft).
//
// The condition type dropdown is grouped by family
// (Text / Number / Date / Empty / Custom formula). Operand inputs
// render conditionally based on the selected type. The style picker
// is inline — bold/italic/underline/strike toggles + two color
// swatches.
//
// The Cancel / Done buttons render in the Drawer footer, not in this
// component, so they stay anchored at the bottom of the panel while
// the form fields scroll. The parent panel calls back into this
// component via a ref handle (see RuleEditorHandle) when the user
// commits, since the draft state lives here.

import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import { forwardRef, useImperativeHandle, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import type {
    CFCondition,
    CFConditionType,
    CFRule,
} from '../../lib/conditional-format/types'
import type { CellFont, CellStyle } from '../../lib/workbook-types'
import { ConditionTypePicker } from './ConditionTypePicker'
import { StylePicker } from './StylePicker'

export interface RuleEditorProps {
    rule: CFRule
    readOnly?: boolean
}

// RuleEditorHandle exposes the editor's "commit current draft" entry
// point to the parent panel. The footer Done button calls
// commit() — the editor assembles its draft into a CFRule and
// returns it; the parent passes that to its onSave handler. The
// editor never imports the parent's save callback so the form keeps
// owning the data flow's local state.
export interface RuleEditorHandle {
    commit(): CFRule
}

export const RuleEditor = forwardRef<RuleEditorHandle, RuleEditorProps>(function RuleEditor(
    { rule, readOnly },
    ref
) {
    const [ranges, setRanges] = useState<string>(
        rule.ranges.length === 0 ? '' : rule.ranges.join(',')
    )
    const [conditionType, setConditionType] = useState<CFConditionType>(rule.condition.type)
    const [value1, setValue1] = useState<string>(rule.condition.value1 ?? '')
    const [value2, setValue2] = useState<string>(rule.condition.value2 ?? '')
    const [formula, setFormula] = useState<string>(rule.condition.formula ?? '')
    const [style, setStyle] = useState<CellStyle>(rule.style)

    useImperativeHandle(
        ref,
        () => ({
            commit(): CFRule {
                const condition: CFCondition = { type: conditionType }
                if (operandCount(conditionType) >= 1 && value1 !== '') condition.value1 = value1
                if (operandCount(conditionType) >= 2 && value2 !== '') condition.value2 = value2
                if (conditionType === 'customFormula' && formula !== '') {
                    condition.formula = formula
                }
                return {
                    id: rule.id,
                    ranges: ranges
                        .split(',')
                        .map((r) => r.trim())
                        .filter((r) => r !== ''),
                    condition,
                    style,
                }
            },
        }),
        [rule.id, ranges, conditionType, value1, value2, formula, style]
    )

    const opCount = operandCount(conditionType)
    const isFormula = conditionType === 'customFormula'

    return (
        <View>
            <FieldLabel>Apply to range</FieldLabel>
            <PlainInput
                value={ranges}
                onChangeText={setRanges}
                editable={!readOnly}
                placeholder="A1:A100"
                className="rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
            />

            <FieldLabel>Format cells if…</FieldLabel>
            <ConditionTypePicker
                value={conditionType}
                onChange={setConditionType}
                disabled={readOnly}
            />

            {opCount >= 1 && !isFormula ? (
                <>
                    <FieldLabel>{`Value${opCount === 2 ? ' (start)' : ''}`}</FieldLabel>
                    <PlainInput
                        value={value1}
                        onChangeText={setValue1}
                        editable={!readOnly}
                        placeholder={placeholderFor(conditionType)}
                        className="rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
                    />
                </>
            ) : null}
            {opCount === 2 ? (
                <>
                    <FieldLabel>Value (end)</FieldLabel>
                    <PlainInput
                        value={value2}
                        onChangeText={setValue2}
                        editable={!readOnly}
                        placeholder={placeholderFor(conditionType)}
                        className="rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
                    />
                </>
            ) : null}
            {isFormula ? (
                <>
                    <FieldLabel>Formula</FieldLabel>
                    <View className="flex-row items-center gap-1">
                        <Text className="text-sm text-muted-foreground">=</Text>
                        <PlainInput
                            value={formula}
                            onChangeText={setFormula}
                            editable={!readOnly}
                            placeholder='$A1>10'
                            className="flex-1 rounded border border-border bg-background px-2 py-1 text-sm text-foreground"
                        />
                    </View>
                </>
            ) : null}

            <FieldLabel>Formatting style</FieldLabel>
            <StylePicker style={style} onChange={setStyle} disabled={readOnly} />
        </View>
    )
})

// Editor action buttons rendered into the Drawer footer by the parent
// panel so they stay anchored at the bottom of the drawer while the
// form body scrolls. The parent supplies the click handlers; this
// component is a pure layout for the two buttons.
export function RuleEditorActions({
    onCancel,
    onDone,
    disabled,
}: {
    onCancel: () => void
    onDone: () => void
    disabled?: boolean
}) {
    return (
        <View className="flex-row justify-end gap-2">
            <ButtonGhost onPress={onCancel} label="Cancel" />
            <ButtonPrimary onPress={onDone} label="Done" disabled={disabled} />
        </View>
    )
}

function FieldLabel({ children }: { children: string }) {
    return (
        <Text className="mt-3 mb-1 text-xs font-medium uppercase text-muted-foreground">
            {children}
        </Text>
    )
}

function ButtonGhost({ onPress, label }: { onPress: () => void; label: string }) {
    return (
        <Pressable
            onPress={onPress}
            className="rounded border border-border px-3 py-1.5"
            accessibilityLabel={label}
        >
            <Text className="text-sm text-foreground">{label}</Text>
        </Pressable>
    )
}

function ButtonPrimary({
    onPress,
    label,
    disabled,
}: {
    onPress: () => void
    label: string
    disabled?: boolean
}) {
    const bg = useThemeColor('accent')
    const fg = useThemeColor('accent-foreground')
    return (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            className="rounded px-3 py-1.5"
            style={{ backgroundColor: bg, opacity: disabled ? 0.5 : 1 }}
            accessibilityLabel={label}
        >
            <Text style={{ color: fg, fontSize: 14 }}>{label}</Text>
        </Pressable>
    )
}

function operandCount(type: CFConditionType): 0 | 1 | 2 {
    if (type === 'isEmpty' || type === 'isNotEmpty' || type === 'customFormula' || type === 'xlsxOpaque')
        return 0
    if (type === 'numberBetween' || type === 'numberNotBetween') return 2
    return 1
}

function placeholderFor(type: CFConditionType): string {
    if (type.startsWith('date')) return 'YYYY-MM-DD'
    if (type.startsWith('number')) return '0'
    return 'text'
}

// Re-export for tests / external use of the no-op marker (e.g. when
// callers construct a draft style and want to preserve the font sub-
// type's shape). Not used here.
export type RuleEditorFontStyle = CellFont
