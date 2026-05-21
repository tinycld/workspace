import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Modal, ModalBackdrop, ModalContent } from '@tinycld/core/ui/modal'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import {
    buildRRule,
    describeRRule,
    getContextualPresets,
    getWeekdayPosition,
    parseRRule,
    type RRuleOptions,
} from '../lib/recurrence'

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const FREQ_OPTIONS = [
    { label: 'day', value: 'DAILY' as const },
    { label: 'week', value: 'WEEKLY' as const },
    { label: 'month', value: 'MONTHLY' as const },
    { label: 'year', value: 'YEARLY' as const },
]

interface RecurrencePickerProps {
    value: string
    onChange: (rrule: string) => void
    eventStartDate: Date
}

export function RecurrencePicker({ value, onChange, eventStartDate }: RecurrencePickerProps) {
    const [showCustom, setShowCustom] = useState(false)
    const [showPresets, setShowPresets] = useState(false)
    const presets = getContextualPresets(eventStartDate)

    const displayLabel = value ? describeRRule(value, eventStartDate) : 'Does not repeat'

    const isPresetValue = presets.some((p) => p.value === value)

    const handlePresetSelect = (preset: string) => {
        setShowPresets(false)
        if (preset === '__custom__') {
            setShowCustom(true)
        } else {
            onChange(preset)
        }
    }

    return (
        <View className="gap-1.5 mb-3">
            <Text className="text-foreground" style={{ fontSize: 14, fontWeight: '600' }}>
                Recurrence
            </Text>
            <Pressable
                onPress={() => setShowPresets(true)}
                className="border border-border bg-background rounded-lg px-3 py-2.5"
            >
                <Text className={value ? 'text-foreground' : 'text-muted-foreground'} style={{ fontSize: 14 }}>
                    {displayLabel}
                </Text>
            </Pressable>

            <PresetDialog
                open={showPresets}
                onOpenChange={setShowPresets}
                presets={presets}
                currentValue={value}
                onSelect={handlePresetSelect}
            />

            <CustomRecurrenceDialog
                open={showCustom}
                onOpenChange={setShowCustom}
                eventStartDate={eventStartDate}
                initialValue={isPresetValue ? undefined : value}
                onSave={onChange}
            />
        </View>
    )
}

function PresetDialog({
    open,
    onOpenChange,
    presets,
    currentValue,
    onSelect,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    presets: { label: string; value: string }[]
    currentValue: string
    onSelect: (value: string) => void
}) {
    const accentColor = useThemeColor('accent')

    return (
        <Modal isOpen={open} onClose={() => onOpenChange(false)}>
            <ModalBackdrop />
            <ModalContent className="w-[320px] p-3">
                <Text className="text-foreground" style={{ fontSize: 18, fontWeight: '600', marginBottom: 8 }}>
                    Repeat
                </Text>
                <View className="gap-1 pt-2">
                    {presets.map((preset) => {
                        const isSelected = preset.value === currentValue
                        return (
                            <Pressable
                                key={preset.value || 'none'}
                                onPress={() => onSelect(preset.value)}
                                className="px-3 py-2.5 rounded-md"
                                style={{
                                    ...(isSelected && {
                                        backgroundColor: `${accentColor}20`,
                                    }),
                                }}
                            >
                                <Text
                                    className={isSelected ? 'text-accent-foreground' : 'text-foreground'}
                                    style={{
                                        fontSize: 14,
                                        fontWeight: isSelected ? '600' : '400',
                                    }}
                                >
                                    {preset.label}
                                </Text>
                            </Pressable>
                        )
                    })}
                </View>
            </ModalContent>
        </Modal>
    )
}

interface CustomState {
    freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
    interval: number
    byDay: string[]
    endType: 'never' | 'on' | 'after'
    untilDate: string
    count: number
    monthlyMode: 'dayOfMonth' | 'dayOfWeek'
}

function initCustomState(eventStartDate: Date, initialValue?: string): CustomState {
    const defaults: CustomState = {
        freq: 'WEEKLY',
        interval: 1,
        byDay: [DAY_CODES[eventStartDate.getDay()]],
        endType: 'never',
        untilDate: '',
        count: 13,
        monthlyMode: 'dayOfMonth',
    }

    if (!initialValue) return defaults

    const parsed = parseRRule(initialValue)
    if (!parsed) return defaults

    const state: CustomState = {
        ...defaults,
        freq: parsed.freq,
        interval: parsed.interval || 1,
    }

    if (parsed.byDay && parsed.byDay.length > 0) {
        if (parsed.freq === 'MONTHLY') {
            state.monthlyMode = 'dayOfWeek'
        } else {
            state.byDay = parsed.byDay
        }
    }

    if (parsed.count) {
        state.endType = 'after'
        state.count = parsed.count
    } else if (parsed.until) {
        state.endType = 'on'
        const y = parsed.until.getFullYear()
        const m = String(parsed.until.getMonth() + 1).padStart(2, '0')
        const d = String(parsed.until.getDate()).padStart(2, '0')
        state.untilDate = `${y}-${m}-${d}`
    }

    return state
}

function CustomRecurrenceDialog({
    open,
    onOpenChange,
    eventStartDate,
    initialValue,
    onSave,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    eventStartDate: Date
    initialValue?: string
    onSave: (rrule: string) => void
}) {
    const fgColor = useThemeColor('foreground')
    const borderColor = useThemeColor('border')
    const primaryColor = useThemeColor('primary')
    const primaryFgColor = useThemeColor('primary-foreground')
    const [state, setState] = useState<CustomState>(() => initCustomState(eventStartDate, initialValue))

    const updateState = (partial: Partial<CustomState>) => {
        setState((prev) => ({ ...prev, ...partial }))
    }

    const handleDone = () => {
        const options: RRuleOptions = {
            freq: state.freq,
            interval: state.interval,
        }

        if (state.freq === 'WEEKLY' && state.byDay.length > 0) {
            options.byDay = state.byDay
        }

        if (state.freq === 'DAILY' && state.byDay.length > 0 && state.byDay.length < 7) {
            options.byDay = state.byDay
        }

        if (state.freq === 'MONTHLY') {
            if (state.monthlyMode === 'dayOfWeek') {
                const { position, day } = getWeekdayPosition(eventStartDate)
                options.byDay = [`${position}${day}`]
            } else {
                options.byMonthDay = [eventStartDate.getDate()]
            }
        }

        if (state.endType === 'after' && state.count > 0) {
            options.count = state.count
        } else if (state.endType === 'on' && state.untilDate) {
            options.until = new Date(`${state.untilDate}T23:59:59`)
        }

        onSave(buildRRule(options))
        onOpenChange(false)
    }

    return (
        <Modal isOpen={open} onClose={() => onOpenChange(false)}>
            <ModalBackdrop />
            <ModalContent className="w-[360px] p-4">
                <Text className="text-foreground" style={{ fontSize: 18, fontWeight: '600', marginBottom: 16 }}>
                    Custom recurrence
                </Text>

                <View className="gap-3">
                    <View className="flex-row items-center gap-2">
                        <Text className="text-foreground" style={{ fontSize: 14 }}>
                            Repeat every
                        </Text>
                        <Pressable
                            onPress={() => {
                                updateState({ interval: Math.min(state.interval + 1, 99) })
                            }}
                            onLongPress={() => {
                                updateState({ interval: Math.max(state.interval - 1, 1) })
                            }}
                            className="border border-border rounded-md w-[44px] h-[36px] items-center justify-center"
                        >
                            <Text className="text-foreground" style={{ fontSize: 14, textAlign: 'center' }}>
                                {state.interval}
                            </Text>
                        </Pressable>
                        <View className="flex-row gap-1 flex-wrap flex-1">
                            {FREQ_OPTIONS.map((opt) => {
                                const isSelected = state.freq === opt.value
                                return (
                                    <Pressable
                                        key={opt.value}
                                        onPress={() => updateState({ freq: opt.value })}
                                        className={`px-2.5 py-1 rounded-md border ${isSelected ? 'bg-primary' : ''}`}
                                        style={{
                                            borderColor: isSelected ? primaryColor : borderColor,
                                        }}
                                    >
                                        <Text
                                            className={isSelected ? 'text-primary-foreground' : 'text-foreground'}
                                            style={{ fontSize: 12 }}
                                        >
                                            {state.interval > 1 ? `${opt.label}s` : opt.label}
                                        </Text>
                                    </Pressable>
                                )
                            })}
                        </View>
                    </View>

                    <WeekDaySelector
                        isVisible={state.freq === 'WEEKLY'}
                        selectedDays={state.byDay}
                        onToggle={(day) => {
                            const has = state.byDay.includes(day)
                            if (has) {
                                if (state.byDay.length > 1) {
                                    updateState({
                                        byDay: state.byDay.filter((d) => d !== day),
                                    })
                                }
                            } else {
                                updateState({ byDay: [...state.byDay, day] })
                            }
                        }}
                    />

                    <MonthlyModeSelector
                        isVisible={state.freq === 'MONTHLY'}
                        monthlyMode={state.monthlyMode}
                        eventStartDate={eventStartDate}
                        onChange={(mode) => updateState({ monthlyMode: mode })}
                    />

                    <View className="gap-2">
                        <Text className="text-foreground" style={{ fontSize: 14, fontWeight: '600' }}>
                            Ends
                        </Text>
                        <View className="flex-row gap-2 flex-wrap">
                            {(['never', 'on', 'after'] as const).map((type) => {
                                const isSelected = state.endType === type
                                const label = type === 'never' ? 'Never' : type === 'on' ? 'On date' : 'After'
                                return (
                                    <Pressable
                                        key={type}
                                        onPress={() => updateState({ endType: type })}
                                        className={`px-2.5 py-1 rounded-md border ${isSelected ? 'bg-primary' : ''}`}
                                        style={{
                                            borderColor: isSelected ? primaryColor : borderColor,
                                        }}
                                    >
                                        <Text
                                            className={isSelected ? 'text-primary-foreground' : 'text-foreground'}
                                            style={{ fontSize: 12 }}
                                        >
                                            {label}
                                        </Text>
                                    </Pressable>
                                )
                            })}
                        </View>

                        <EndDateInput
                            isVisible={state.endType === 'on'}
                            value={state.untilDate}
                            onChange={(val) => updateState({ untilDate: val })}
                        />

                        <EndCountInput
                            isVisible={state.endType === 'after'}
                            value={state.count}
                            onIncrement={() => updateState({ count: Math.min(state.count + 1, 999) })}
                            onDecrement={() => updateState({ count: Math.max(state.count - 1, 1) })}
                        />
                    </View>
                </View>

                <View className="flex-row justify-end gap-2 pt-2">
                    <Pressable
                        onPress={() => onOpenChange(false)}
                        className="px-3 py-1.5 rounded-md border border-border"
                    >
                        <Text className="text-foreground" style={{ fontSize: 14 }}>
                            Cancel
                        </Text>
                    </Pressable>
                    <Pressable onPress={handleDone} className="px-3 py-1.5 rounded-md bg-primary">
                        <Text className="text-primary-foreground" style={{ fontSize: 14, fontWeight: '600' }}>
                            Done
                        </Text>
                    </Pressable>
                </View>
            </ModalContent>
        </Modal>
    )
}

function WeekDaySelector({
    isVisible,
    selectedDays,
    onToggle,
}: {
    isVisible: boolean
    selectedDays: string[]
    onToggle: (day: string) => void
}) {
    const borderColor = useThemeColor('border')
    const primaryColor = useThemeColor('primary')

    if (!isVisible) return null

    return (
        <View className="gap-1.5">
            <Text className="text-foreground" style={{ fontSize: 14, fontWeight: '600' }}>
                Repeat on
            </Text>
            <View className="flex-row gap-1.5 justify-center">
                {DAY_CODES.map((code, i) => {
                    const isSelected = selectedDays.includes(code)
                    return (
                        <Pressable
                            key={code}
                            onPress={() => onToggle(code)}
                            className={`size-9 rounded-full border items-center justify-center ${isSelected ? 'bg-primary' : ''}`}
                            style={{
                                borderColor: isSelected ? primaryColor : borderColor,
                            }}
                        >
                            <Text
                                className={isSelected ? 'text-white' : 'text-foreground'}
                                style={{ fontSize: 12, fontWeight: isSelected ? '600' : '400' }}
                            >
                                {DAY_LABELS[i]}
                            </Text>
                        </Pressable>
                    )
                })}
            </View>
        </View>
    )
}

function MonthlyModeSelector({
    isVisible,
    monthlyMode,
    eventStartDate,
    onChange,
}: {
    isVisible: boolean
    monthlyMode: 'dayOfMonth' | 'dayOfWeek'
    eventStartDate: Date
    onChange: (mode: 'dayOfMonth' | 'dayOfWeek') => void
}) {
    const borderColor = useThemeColor('border')
    const primaryColor = useThemeColor('primary')

    if (!isVisible) return null

    const dayOfMonth = eventStartDate.getDate()
    const { position } = getWeekdayPosition(eventStartDate)
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const dayName = dayNames[eventStartDate.getDay()]
    const ordinals = ['', 'first', 'second', 'third', 'fourth', 'fifth']
    const ordinal = ordinals[position] ?? `${position}th`

    return (
        <View className="gap-1.5">
            <Text className="text-foreground" style={{ fontSize: 14, fontWeight: '600' }}>
                Monthly on
            </Text>
            <View className="flex-row gap-2">
                <Pressable
                    onPress={() => onChange('dayOfMonth')}
                    className={`px-2.5 py-1 rounded-md border ${monthlyMode === 'dayOfMonth' ? 'bg-primary' : ''}`}
                    style={{
                        borderColor: monthlyMode === 'dayOfMonth' ? primaryColor : borderColor,
                    }}
                >
                    <Text
                        className={monthlyMode === 'dayOfMonth' ? 'text-primary-foreground' : 'text-foreground'}
                        style={{ fontSize: 12 }}
                    >
                        Day {dayOfMonth}
                    </Text>
                </Pressable>
                <Pressable
                    onPress={() => onChange('dayOfWeek')}
                    className={`px-2.5 py-1 rounded-md border ${monthlyMode === 'dayOfWeek' ? 'bg-primary' : ''}`}
                    style={{
                        borderColor: monthlyMode === 'dayOfWeek' ? primaryColor : borderColor,
                    }}
                >
                    <Text
                        className={monthlyMode === 'dayOfWeek' ? 'text-primary-foreground' : 'text-foreground'}
                        style={{ fontSize: 12 }}
                    >
                        {ordinal} {dayName}
                    </Text>
                </Pressable>
            </View>
        </View>
    )
}

function EndDateInput({
    isVisible,
    value,
    onChange,
}: {
    isVisible: boolean
    value: string
    onChange: (val: string) => void
}) {
    const mutedColor = useThemeColor('field-placeholder')

    if (!isVisible) return null

    return (
        <View className="flex-row items-center gap-2">
            <Text className="text-foreground" style={{ fontSize: 14 }}>
                End date:
            </Text>
            <PlainInput
                value={value}
                onChangeText={onChange}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={mutedColor}
                className="border border-border text-foreground rounded-md px-2.5 py-1.5 flex-1"
                style={{ fontSize: 14 }}
            />
        </View>
    )
}

function EndCountInput({
    isVisible,
    value,
    onIncrement,
    onDecrement,
}: {
    isVisible: boolean
    value: number
    onIncrement: () => void
    onDecrement: () => void
}) {
    if (!isVisible) return null

    return (
        <View className="flex-row items-center gap-2">
            <Text className="text-foreground" style={{ fontSize: 14 }}>
                After
            </Text>
            <View className="flex-row items-center gap-1">
                <Pressable onPress={onDecrement} className="px-2.5 py-1 rounded-md border border-border">
                    <Text className="text-foreground" style={{ fontSize: 12 }}>
                        -
                    </Text>
                </Pressable>
                <Text className="text-foreground" style={{ fontSize: 14, textAlign: 'center', width: 40 }}>
                    {value}
                </Text>
                <Pressable onPress={onIncrement} className="px-2.5 py-1 rounded-md border border-border">
                    <Text className="text-foreground" style={{ fontSize: 12 }}>
                        +
                    </Text>
                </Pressable>
            </View>
            <Text className="text-foreground" style={{ fontSize: 14 }}>
                occurrences
            </Text>
        </View>
    )
}
