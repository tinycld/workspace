import { zodResolver } from '@hookform/resolvers/zod'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import { ChevronDown, Search, Square, SquareCheck, X } from 'lucide-react-native'
import { useCallback, useMemo, useState } from 'react'
import { useController, useForm } from 'react-hook-form'
import { Platform, Pressable, ScrollView, type StyleProp, StyleSheet, Text, type TextStyle, View } from 'react-native'
import { z } from 'zod'
import type { AdvancedSearchFilters } from '../hooks/useSearchState'

const schema = z.object({
    from: z.string(),
    to: z.string(),
    subject: z.string(),
    hasWords: z.string(),
    doesntHave: z.string(),
    sizeOp: z.enum(['greater_than', 'less_than']),
    sizeValue: z.string(),
    sizeUnit: z.enum(['MB', 'KB', 'bytes']),
    dateWithin: z.enum(['', '1d', '3d', '1w', '2w', '1m', '2m', '6m', '1y']),
    dateAnchor: z.string(),
    folder: z.enum(['all', 'inbox', 'sent', 'drafts', 'trash', 'spam', 'starred']),
    hasAttachment: z.boolean(),
})

type FormValues = z.infer<typeof schema>

function makeDefaultValues(): FormValues {
    return {
        from: '',
        to: '',
        subject: '',
        hasWords: '',
        doesntHave: '',
        sizeOp: 'greater_than',
        sizeValue: '',
        sizeUnit: 'MB',
        dateWithin: '',
        dateAnchor: new Date().toISOString().split('T')[0],
        folder: 'all',
        hasAttachment: false,
    }
}

function formDataToFilters(data: FormValues): AdvancedSearchFilters {
    const filters: AdvancedSearchFilters = {}
    const textFields = ['from', 'to', 'subject', 'hasWords', 'doesntHave'] as const
    for (const key of textFields) {
        if (data[key]) filters[key] = data[key]
    }
    if (data.sizeValue) {
        filters.sizeOp = data.sizeOp
        filters.sizeValue = data.sizeValue
        filters.sizeUnit = data.sizeUnit
    }
    if (data.dateWithin) {
        filters.dateWithin = data.dateWithin
        filters.dateAnchor = data.dateAnchor
    }
    if (data.folder !== 'all') filters.folder = data.folder
    if (data.hasAttachment) filters.hasAttachment = true
    return filters
}

interface AdvancedSearchDropdownProps {
    onApply: (filters: AdvancedSearchFilters) => void
    onClose: () => void
    initialFilters?: AdvancedSearchFilters
}

export function AdvancedSearchDropdown({ onApply, onClose, initialFilters }: AdvancedSearchDropdownProps) {
    const foregroundColor = useThemeColor('foreground')
    const mutedColor = useThemeColor('muted-foreground')
    const borderColor = useThemeColor('border')
    const backgroundColor = useThemeColor('background')
    const primaryColor = useThemeColor('primary')
    const primaryFgColor = useThemeColor('primary-foreground')
    const shadowColor = useThemeColor('border')
    const focusBgColor = useThemeColor('surface-secondary')

    const defaults = useMemo(() => ({ ...makeDefaultValues(), ...initialFilters }), [initialFilters])

    const { control, handleSubmit, setValue, watch, reset } = useForm<FormValues>({
        resolver: zodResolver(schema),
        defaultValues: defaults,
    })

    const onSubmit = handleSubmit((data) => {
        onApply(formDataToFilters(data))
        onClose()
    })

    const onClear = useCallback(() => {
        reset(makeDefaultValues())
        onApply({})
        onClose()
    }, [reset, onApply, onClose])

    const hasAttachment = watch('hasAttachment')

    const toggleAttachment = useCallback(() => {
        setValue('hasAttachment', !hasAttachment)
    }, [hasAttachment, setValue])

    const inputStyle = [
        styles.input,
        {
            color: foregroundColor,
            borderColor,
        },
    ]

    return (
        <>
            <Pressable style={styles.overlay} onPress={onClose} />
            <View
                style={[
                    {
                        position: 'absolute',
                        top: 4,
                        left: 0,
                        right: 0,
                        zIndex: 100,
                        borderRadius: 12,
                        borderWidth: 1,
                        maxHeight: 480,
                        backgroundColor,
                        borderColor,
                    },
                    Platform.select({
                        web: {
                            boxShadow: `0 4px 24px ${shadowColor}`,
                        },
                        default: {
                            shadowColor,
                            shadowOffset: { width: 0, height: 4 },
                            shadowOpacity: 0.15,
                            shadowRadius: 12,
                            elevation: 8,
                        },
                    }),
                ]}
            >
                <ScrollView style={{ padding: 16 }} keyboardShouldPersistTaps="handled">
                    <FieldRow label="From" labelColor={mutedColor}>
                        <FormInput control={control} name="from" style={inputStyle} placeholder="" />
                    </FieldRow>
                    <FieldRow label="To" labelColor={mutedColor}>
                        <FormInput control={control} name="to" style={inputStyle} placeholder="" />
                    </FieldRow>
                    <FieldRow label="Subject" labelColor={mutedColor}>
                        <FormInput control={control} name="subject" style={inputStyle} placeholder="" />
                    </FieldRow>
                    <FieldRow label="Has the words" labelColor={mutedColor}>
                        <FormInput control={control} name="hasWords" style={inputStyle} placeholder="" />
                    </FieldRow>
                    <FieldRow label="Doesn't have" labelColor={mutedColor}>
                        <FormInput control={control} name="doesntHave" style={inputStyle} placeholder="" />
                    </FieldRow>
                    <FieldRow label="Size" labelColor={mutedColor}>
                        <View className="flex-row items-center gap-2">
                            <PickerButton
                                control={control}
                                name="sizeOp"
                                options={SIZE_OP_OPTIONS}
                                foregroundColor={foregroundColor}
                                mutedColor={mutedColor}
                                borderColor={borderColor}
                                backgroundColor={backgroundColor}
                                focusBgColor={focusBgColor}
                            />
                            <FormInput
                                control={control}
                                name="sizeValue"
                                style={[...inputStyle, styles.numberInput]}
                                placeholder=""
                                keyboardType="numeric"
                            />
                            <PickerButton
                                control={control}
                                name="sizeUnit"
                                options={SIZE_UNIT_OPTIONS}
                                foregroundColor={foregroundColor}
                                mutedColor={mutedColor}
                                borderColor={borderColor}
                                backgroundColor={backgroundColor}
                                focusBgColor={focusBgColor}
                            />
                        </View>
                    </FieldRow>
                    <FieldRow label="Date within" labelColor={mutedColor}>
                        <View className="flex-row items-center gap-2">
                            <PickerButton
                                control={control}
                                name="dateWithin"
                                options={DATE_WITHIN_OPTIONS}
                                foregroundColor={foregroundColor}
                                mutedColor={mutedColor}
                                borderColor={borderColor}
                                backgroundColor={backgroundColor}
                                focusBgColor={focusBgColor}
                            />
                            <FormInput
                                control={control}
                                name="dateAnchor"
                                style={inputStyle}
                                placeholder="YYYY-MM-DD"
                            />
                        </View>
                    </FieldRow>
                    <FieldRow label="Search" labelColor={mutedColor}>
                        <PickerButton
                            control={control}
                            name="folder"
                            options={FOLDER_OPTIONS}
                            foregroundColor={foregroundColor}
                            mutedColor={mutedColor}
                            borderColor={borderColor}
                            backgroundColor={backgroundColor}
                            focusBgColor={focusBgColor}
                        />
                    </FieldRow>
                    <FieldRow label="Has attachment" labelColor={mutedColor}>
                        <Pressable onPress={toggleAttachment} className="flex-row items-center py-1">
                            {hasAttachment ? (
                                <SquareCheck size={20} color={primaryColor} />
                            ) : (
                                <Square size={20} color={mutedColor} />
                            )}
                        </Pressable>
                    </FieldRow>
                </ScrollView>
                <View
                    className="flex-row justify-end items-center gap-3 px-4 py-3"
                    style={{
                        borderTopWidth: StyleSheet.hairlineWidth,
                        borderTopColor: borderColor,
                    }}
                >
                    <Pressable onPress={onClear} className="flex-row items-center gap-1 px-3 py-2">
                        <X size={14} color={mutedColor} />
                        <Text style={{ fontSize: 14, color: mutedColor }}>Clear</Text>
                    </Pressable>
                    <Pressable
                        onPress={onSubmit}
                        className="flex-row items-center py-2 rounded-full"
                        style={{
                            gap: 6,
                            paddingHorizontal: 20,
                            backgroundColor: primaryColor,
                        }}
                    >
                        <Search size={16} color={primaryFgColor} />
                        <Text style={{ fontSize: 14, fontWeight: '600', color: primaryFgColor }}>Search</Text>
                    </Pressable>
                </View>
            </View>
        </>
    )
}

function FieldRow({ label, labelColor, children }: { label: string; labelColor: string; children: React.ReactNode }) {
    return (
        <View className="flex-row items-center mb-3" style={{ minHeight: 36 }}>
            <Text style={{ width: 110, fontSize: 13, flexShrink: 0, color: labelColor }}>{label}</Text>
            <View className="flex-1">{children}</View>
        </View>
    )
}

function FormInput({
    control,
    name,
    style,
    placeholder,
    keyboardType,
}: {
    control: ReturnType<typeof useForm<FormValues>>['control']
    name: keyof FormValues
    style: StyleProp<TextStyle>
    placeholder: string
    keyboardType?: 'numeric' | 'default'
}) {
    const { field } = useController({ control, name })

    return (
        <PlainInput
            style={style}
            value={String(field.value ?? '')}
            onChangeText={field.onChange}
            placeholder={placeholder}
            keyboardType={keyboardType}
        />
    )
}

interface PickerOption {
    label: string
    value: string
}

const SIZE_OP_OPTIONS: PickerOption[] = [
    { label: 'greater than', value: 'greater_than' },
    { label: 'less than', value: 'less_than' },
]

const SIZE_UNIT_OPTIONS: PickerOption[] = [
    { label: 'MB', value: 'MB' },
    { label: 'KB', value: 'KB' },
    { label: 'bytes', value: 'bytes' },
]

const DATE_WITHIN_OPTIONS: PickerOption[] = [
    { label: 'any time', value: '' },
    { label: '1 day', value: '1d' },
    { label: '3 days', value: '3d' },
    { label: '1 week', value: '1w' },
    { label: '2 weeks', value: '2w' },
    { label: '1 month', value: '1m' },
    { label: '2 months', value: '2m' },
    { label: '6 months', value: '6m' },
    { label: '1 year', value: '1y' },
]

const FOLDER_OPTIONS: PickerOption[] = [
    { label: 'All Mail', value: 'all' },
    { label: 'Inbox', value: 'inbox' },
    { label: 'Sent', value: 'sent' },
    { label: 'Drafts', value: 'drafts' },
    { label: 'Trash', value: 'trash' },
    { label: 'Spam', value: 'spam' },
    { label: 'Starred', value: 'starred' },
]

function PickerButton({
    control,
    name,
    options,
    foregroundColor,
    mutedColor,
    borderColor,
    backgroundColor,
    focusBgColor,
}: {
    control: ReturnType<typeof useForm<FormValues>>['control']
    name: keyof FormValues
    options: PickerOption[]
    foregroundColor: string
    mutedColor: string
    borderColor: string
    backgroundColor: string
    focusBgColor: string
}) {
    const { field } = useController({ control, name })
    const [isOpen, setIsOpen] = useState(false)

    const selectedLabel = options.find((o) => o.value === field.value)?.label ?? options[0].label

    return (
        <View className="relative">
            <Pressable
                onPress={() => setIsOpen(!isOpen)}
                className="flex-row items-center gap-1 py-1"
                style={{
                    borderBottomWidth: 1,
                    paddingHorizontal: 2,
                    borderBottomColor: borderColor,
                }}
            >
                <Text style={{ fontSize: 14, color: foregroundColor }} numberOfLines={1}>
                    {selectedLabel}
                </Text>
                <ChevronDown size={14} color={mutedColor} />
            </Pressable>
            {isOpen ? (
                <PickerMenu
                    options={options}
                    value={String(field.value)}
                    onSelect={(val) => {
                        field.onChange(val)
                        setIsOpen(false)
                    }}
                    onClose={() => setIsOpen(false)}
                    foregroundColor={foregroundColor}
                    borderColor={borderColor}
                    backgroundColor={backgroundColor}
                    focusBgColor={focusBgColor}
                />
            ) : null}
        </View>
    )
}

function PickerMenu({
    options,
    value,
    onSelect,
    onClose,
    foregroundColor,
    borderColor,
    backgroundColor,
    focusBgColor,
}: {
    options: PickerOption[]
    value: string
    onSelect: (value: string) => void
    onClose: () => void
    foregroundColor: string
    borderColor: string
    backgroundColor: string
    focusBgColor: string
}) {
    return (
        <>
            <Pressable
                style={[styles.pickerOverlay, Platform.OS === 'web' && styles.pickerOverlayWeb]}
                onPress={onClose}
            />
            <View
                className="absolute border rounded-lg py-1"
                style={{
                    top: '100%',
                    left: 0,
                    zIndex: 201,
                    minWidth: 140,
                    marginTop: 2,
                    backgroundColor,
                    borderColor,
                }}
            >
                {options.map((option) => (
                    <Pressable
                        key={option.value}
                        onPress={() => onSelect(option.value)}
                        className="px-3 py-2"
                        style={[
                            option.value === value && {
                                backgroundColor: focusBgColor,
                            },
                        ]}
                    >
                        <Text style={{ fontSize: 13, color: foregroundColor }}>{option.label}</Text>
                    </Pressable>
                ))}
            </View>
        </>
    )
}

const styles = StyleSheet.create({
    overlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 99,
    },
    input: {
        flex: 1,
        fontSize: 14,
        borderBottomWidth: 1,
        paddingVertical: 4,
        paddingHorizontal: 2,
    },
    numberInput: {
        maxWidth: 80,
    },
    pickerOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 200,
    },
    pickerOverlayWeb: {
        position: 'fixed' as 'absolute',
    },
})
