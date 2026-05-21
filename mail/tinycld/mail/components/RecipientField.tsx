import { NameAvatar as ContactAvatar } from '@tinycld/core/components/NameAvatar'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import { type Control, type Path, useController } from 'react-hook-form'
import { Pressable, Text, View } from 'react-native'
import type { ComposeFormData } from '../hooks/composeSchema'
import { type ContactSuggestion, useParsedRecipients } from '../hooks/useRecipientSuggestions'
import { ContactSuggestionsList } from './ContactSuggestionsList'

interface RecipientFieldProps {
    control: Control<ComposeFormData>
    name: Path<ComposeFormData>
    placeholder?: string
    autoFocus?: boolean
}

function RecipientChip({ name, email, onRemove }: { name: string; email: string; onRemove: () => void }) {
    const foregroundColor = useThemeColor('foreground')
    const mutedColor = useThemeColor('muted-foreground')
    const surfaceColor = useThemeColor('surface-secondary')
    const borderColor = useThemeColor('border')
    const displayName = name || email
    const firstName = name.split(' ')[0] || email.split('@')[0]
    const lastName = name.split(' ').slice(1).join(' ')

    return (
        <View
            className="flex-row items-center gap-1.5 px-1 py-0.5 rounded-xl border"
            style={{
                backgroundColor: surfaceColor,
                borderColor,
            }}
        >
            <ContactAvatar firstName={firstName} lastName={lastName} size={18} />
            <Text style={{ fontSize: 12, maxWidth: 140, color: foregroundColor }} numberOfLines={1}>
                {displayName}
            </Text>
            <Pressable onPress={onRemove} hitSlop={6} className="">
                <Text style={{ fontSize: 15, lineHeight: 16, fontWeight: '600', color: mutedColor }}>x</Text>
            </Pressable>
        </View>
    )
}

export function RecipientField({ control, name, placeholder, autoFocus }: RecipientFieldProps) {
    const foregroundColor = useThemeColor('foreground')
    const placeholderColor = useThemeColor('field-placeholder')
    const { field } = useController({ control, name })

    const {
        committed: committedRecipients,
        committedEmails,
        activeQuery,
        committedRaw,
    } = useParsedRecipients(field.value)

    const handleSelect = (contact: ContactSuggestion) => {
        const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(' ')
        const formatted = `${fullName} <${contact.email}>`
        field.onChange(`${committedRaw}${formatted}, `)
    }

    const handleRemoveChip = (index: number) => {
        const updated = committedRecipients.filter((_, i) => i !== index)
        const joined = updated.map((r) => (r.name ? `${r.name} <${r.email}>` : r.email)).join(', ')
        const newRaw = updated.length > 0 ? `${joined}, ` : ''
        field.onChange(`${newRaw}${activeQuery}`)
    }

    const handleChangeText = (text: string) => {
        field.onChange(committedRaw + text)
    }

    return (
        <View className="relative flex-1">
            <View className="flex-row flex-wrap items-center gap-1 min-h-[28px]">
                {committedRecipients.map((r, i) => {
                    return (
                        <RecipientChip
                            key={r.email}
                            name={r.name}
                            email={r.email}
                            onRemove={() => handleRemoveChip(i)}
                        />
                    )
                })}
                <PlainInput
                    className="flex-1 px-1 min-w-[80px]"
                    style={{
                        fontSize: 13,
                        color: foregroundColor,
                    }}
                    placeholderTextColor={placeholderColor}
                    value={activeQuery}
                    onChangeText={handleChangeText}
                    onBlur={field.onBlur}
                    placeholder={committedRecipients.length === 0 ? placeholder : undefined}
                    autoFocus={autoFocus}
                />
            </View>
            <ContactSuggestionsList
                activeQuery={activeQuery}
                committedEmails={committedEmails}
                onSelect={handleSelect}
            />
        </View>
    )
}
