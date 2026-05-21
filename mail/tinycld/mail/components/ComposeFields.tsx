import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import { useState } from 'react'
import { type Control, type FieldErrors, useController } from 'react-hook-form'
import { Pressable, Text, View } from 'react-native'
import type { ComposeFormData } from '../hooks/composeSchema'
import { RecipientField } from './RecipientField'

interface ComposeFieldsProps {
    control: Control<ComposeFormData>
    errors: FieldErrors<ComposeFormData>
    onSubjectBlur?: () => void
}

function ComposeFieldInput({
    control,
    name,
    onBlur: onBlurExtra,
}: {
    control: Control<ComposeFormData>
    name: keyof ComposeFormData
    onBlur?: () => void
}) {
    const foregroundColor = useThemeColor('foreground')
    const placeholderColor = useThemeColor('field-placeholder')
    const { field } = useController({ control, name })

    return (
        <PlainInput
            style={{ flex: 1, fontSize: 13, paddingHorizontal: 4, color: foregroundColor }}
            placeholderTextColor={placeholderColor}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={() => {
                field.onBlur()
                onBlurExtra?.()
            }}
        />
    )
}

export function ComposeFields({ control, errors, onSubjectBlur }: ComposeFieldsProps) {
    const mutedColor = useThemeColor('muted-foreground')
    const borderColor = useThemeColor('border')
    const dangerColor = useThemeColor('danger')
    const [showCc, setShowCc] = useState(false)
    const [showBcc, setShowBcc] = useState(false)

    return (
        <View className="overflow-visible" style={{ zIndex: 10 }}>
            <View
                className="flex-row items-center px-3 py-1 overflow-visible"
                style={{
                    minHeight: 36,
                    borderBottomWidth: 1,
                    zIndex: 11,
                    borderBottomColor: errors.to ? dangerColor : borderColor,
                }}
            >
                <Text style={{ fontSize: 13, width: 56, color: mutedColor }}>To</Text>
                <RecipientField control={control} name="to" autoFocus />
                {!showCc || !showBcc ? (
                    <View className="flex-row gap-2 ml-2">
                        {showCc ? null : (
                            <Pressable onPress={() => setShowCc(true)} tabIndex={-1}>
                                <Text style={{ fontSize: 13, fontWeight: '500', color: mutedColor }}>Cc</Text>
                            </Pressable>
                        )}
                        {showBcc ? null : (
                            <Pressable onPress={() => setShowBcc(true)} tabIndex={-1}>
                                <Text style={{ fontSize: 13, fontWeight: '500', color: mutedColor }}>Bcc</Text>
                            </Pressable>
                        )}
                    </View>
                ) : null}
            </View>
            {showCc ? (
                <View
                    className="flex-row items-center px-3 py-1 overflow-visible"
                    style={{
                        minHeight: 36,
                        borderBottomWidth: 1,
                        zIndex: 11,
                        borderBottomColor: errors.cc ? dangerColor : borderColor,
                    }}
                >
                    <Text style={{ fontSize: 13, width: 56, color: mutedColor }}>Cc</Text>
                    <RecipientField control={control} name="cc" />
                </View>
            ) : null}
            {showBcc ? (
                <View
                    className="flex-row items-center px-3 py-1 overflow-visible"
                    style={{
                        minHeight: 36,
                        borderBottomWidth: 1,
                        zIndex: 11,
                        borderBottomColor: errors.bcc ? dangerColor : borderColor,
                    }}
                >
                    <Text style={{ fontSize: 13, width: 56, color: mutedColor }}>Bcc</Text>
                    <RecipientField control={control} name="bcc" />
                </View>
            ) : null}
            <View
                className="flex-row items-center px-3"
                style={{
                    height: 36,
                    borderBottomWidth: 1,
                    borderBottomColor: errors.subject ? dangerColor : borderColor,
                }}
            >
                <Text style={{ fontSize: 13, width: 56, color: mutedColor }}>Subject</Text>
                <ComposeFieldInput control={control} name="subject" onBlur={onSubjectBlur} />
            </View>
        </View>
    )
}
