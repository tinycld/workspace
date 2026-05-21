// Dropdown for the 18 CF condition types. Grouped into Empty / Text /
// Number / Date / Custom-formula sections matching Sheets' selector.
// The trigger button shows the currently selected option's label so
// the user can scan-read the rule editor without expanding the menu.

import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu, Separator } from '@tinycld/core/ui/menu'
import { ChevronDown } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, ScrollView, Text } from 'react-native'
import type { CFConditionType } from '../../lib/conditional-format/types'

interface Group {
    title: string
    options: ReadonlyArray<{ value: CFConditionType; label: string }>
}

const GROUPS: ReadonlyArray<Group> = [
    {
        title: 'Empty',
        options: [
            { value: 'isEmpty', label: 'Cell is empty' },
            { value: 'isNotEmpty', label: 'Cell is not empty' },
        ],
    },
    {
        title: 'Text',
        options: [
            { value: 'textContains', label: 'Text contains' },
            { value: 'textDoesNotContain', label: 'Text does not contain' },
            { value: 'textStartsWith', label: 'Text starts with' },
            { value: 'textEndsWith', label: 'Text ends with' },
            { value: 'textEquals', label: 'Text is exactly' },
        ],
    },
    {
        title: 'Date',
        options: [
            { value: 'dateIs', label: 'Date is' },
            { value: 'dateBefore', label: 'Date is before' },
            { value: 'dateAfter', label: 'Date is after' },
        ],
    },
    {
        title: 'Number',
        options: [
            { value: 'numberEquals', label: 'Equal to' },
            { value: 'numberNotEquals', label: 'Not equal to' },
            { value: 'numberGreater', label: 'Greater than' },
            { value: 'numberGreaterOrEqual', label: 'Greater than or equal to' },
            { value: 'numberLess', label: 'Less than' },
            { value: 'numberLessOrEqual', label: 'Less than or equal to' },
            { value: 'numberBetween', label: 'Is between' },
            { value: 'numberNotBetween', label: 'Is not between' },
        ],
    },
    {
        title: 'Formula',
        options: [{ value: 'customFormula', label: 'Custom formula is' }],
    },
]

interface ConditionTypePickerProps {
    value: CFConditionType
    onChange: (type: CFConditionType) => void
    disabled?: boolean
}

export function ConditionTypePicker({ value, onChange, disabled }: ConditionTypePickerProps) {
    const [isOpen, setIsOpen] = useState(false)
    const muted = useThemeColor('muted-foreground')

    const activeLabel = labelFor(value)

    return (
        <Menu isOpen={isOpen} onOpenChange={setIsOpen}>
            <Menu.Trigger>
                <Pressable
                    disabled={disabled}
                    className="flex-row items-center justify-between rounded border border-border bg-background px-2 py-1.5"
                    accessibilityLabel="Choose condition"
                >
                    <Text className="text-sm text-foreground" numberOfLines={1}>
                        {activeLabel}
                    </Text>
                    <ChevronDown size={14} color={muted} />
                </Pressable>
            </Menu.Trigger>
            <Menu.Portal>
                <Menu.Content placement="bottom" align="start" style={{ maxHeight: 360 }}>
                    {/* 18 condition types + 5 group labels + separators
                     * exceeds the viewport on a 720-tall window. Without
                     * a scrollable cap, items past the viewport edge
                     * render off-screen and are unhittable by pointer
                     * events even though they have a non-zero layout
                     * rect — the symptom is "click does nothing", which
                     * is exactly the bug this dropdown used to have. */}
                    <ScrollView style={{ maxHeight: 360 }}>
                        {GROUPS.flatMap((group, gi) => {
                            const items: React.ReactNode[] = []
                            if (gi > 0) items.push(<Separator key={`sep-${group.title}`} />)
                            items.push(
                                <Menu.Label key={`label-${group.title}`}>
                                    <Menu.ItemTitle>{group.title}</Menu.ItemTitle>
                                </Menu.Label>
                            )
                            for (const opt of group.options) {
                                items.push(
                                    <Menu.Item
                                        key={opt.value}
                                        onPress={() => {
                                            onChange(opt.value)
                                            setIsOpen(false)
                                        }}
                                    >
                                        <Menu.ItemTitle>{opt.label}</Menu.ItemTitle>
                                    </Menu.Item>
                                )
                            }
                            return items
                        })}
                    </ScrollView>
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}

function labelFor(value: CFConditionType): string {
    for (const g of GROUPS) {
        for (const o of g.options) {
            if (o.value === value) return o.label
        }
    }
    return value
}
