// Compact summary of one CF rule for the list view. Renders the
// range(s), a short human-readable condition summary, and a swatch of
// the style preview.

import { Text, View } from 'react-native'
import type { CFRule } from '../../lib/conditional-format/types'

export function RuleListRow({ rule }: { rule: CFRule }) {
    const rangeText = rule.ranges.filter((r) => r !== '').join(', ') || '—'
    const conditionText = describeCondition(rule)
    const previewBg = rule.style.fill?.fgColor ?? rule.style.fill?.bgColor
    const previewFg = rule.style.font?.color
    const bold = rule.style.font?.bold === true
    const italic = rule.style.font?.italic === true
    return (
        <View className="flex-row items-center gap-2 rounded border border-border px-2 py-2">
            <View
                style={{
                    width: 28,
                    height: 28,
                    borderRadius: 4,
                    backgroundColor: previewBg ?? '#F3F3F3',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                <Text
                    style={{
                        color: previewFg ?? '#000000',
                        fontWeight: bold ? 'bold' : 'normal',
                        fontStyle: italic ? 'italic' : 'normal',
                        fontSize: 12,
                    }}
                >
                    123
                </Text>
            </View>
            <View className="flex-1">
                <Text
                    className="text-sm font-medium text-foreground"
                    numberOfLines={1}
                >
                    {rangeText}
                </Text>
                <Text
                    className="text-xs text-muted-foreground"
                    numberOfLines={1}
                >
                    {conditionText}
                </Text>
            </View>
        </View>
    )
}

function describeCondition(rule: CFRule): string {
    const c = rule.condition
    const v1 = c.value1 ?? ''
    const v2 = c.value2 ?? ''
    switch (c.type) {
        case 'isEmpty':
            return 'Cell is empty'
        case 'isNotEmpty':
            return 'Cell is not empty'
        case 'textContains':
            return `Text contains "${v1}"`
        case 'textDoesNotContain':
            return `Text does not contain "${v1}"`
        case 'textStartsWith':
            return `Text starts with "${v1}"`
        case 'textEndsWith':
            return `Text ends with "${v1}"`
        case 'textEquals':
            return `Text is exactly "${v1}"`
        case 'dateIs':
            return `Date is ${v1}`
        case 'dateBefore':
            return `Date is before ${v1}`
        case 'dateAfter':
            return `Date is after ${v1}`
        case 'numberEquals':
            return `Equal to ${v1}`
        case 'numberNotEquals':
            return `Not equal to ${v1}`
        case 'numberGreater':
            return `Greater than ${v1}`
        case 'numberGreaterOrEqual':
            return `Greater than or equal to ${v1}`
        case 'numberLess':
            return `Less than ${v1}`
        case 'numberLessOrEqual':
            return `Less than or equal to ${v1}`
        case 'numberBetween':
            return `Between ${v1} and ${v2}`
        case 'numberNotBetween':
            return `Not between ${v1} and ${v2}`
        case 'customFormula':
            return `Custom formula: =${c.formula ?? ''}`
        case 'xlsxOpaque':
            return 'Imported rule (unsupported type)'
    }
}
