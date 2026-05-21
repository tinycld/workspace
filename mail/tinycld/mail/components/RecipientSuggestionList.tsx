import { NameAvatar as ContactAvatar } from '@tinycld/core/components/NameAvatar'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Platform, Pressable, ScrollView, Text, View } from 'react-native'

interface Suggestion {
    id: string
    first_name: string
    last_name: string
    email: string
}

interface RecipientSuggestionListProps {
    suggestions: Suggestion[]
    query: string
    onSelect: (contact: Suggestion) => void
}

const webShadow = Platform.OS === 'web' ? ({ boxShadow: '0 4px 16px rgba(0,0,0,0.18)' } as Record<string, unknown>) : {}

function HighlightText({ text, query, bold }: { text: string; query: string; bold?: boolean }) {
    const foregroundColor = useThemeColor('foreground')

    if (!query) {
        return (
            <Text
                style={{
                    fontSize: 13,
                    fontWeight: bold ? '500' : undefined,
                    color: foregroundColor,
                }}
            >
                {text}
            </Text>
        )
    }

    const lowerText = text.toLowerCase()
    const lowerQuery = query.toLowerCase()
    const index = lowerText.indexOf(lowerQuery)

    if (index === -1) {
        return (
            <Text
                style={{
                    fontSize: 13,
                    fontWeight: bold ? '500' : undefined,
                    color: foregroundColor,
                }}
            >
                {text}
            </Text>
        )
    }

    return (
        <Text style={{ fontSize: 13, fontWeight: bold ? '500' : undefined, color: foregroundColor }}>
            {text.slice(0, index)}
            <Text style={{ fontSize: 13, fontWeight: '700' }}>{text.slice(index, index + query.length)}</Text>
            {text.slice(index + query.length)}
        </Text>
    )
}

export function RecipientSuggestionList({ suggestions, query, onSelect }: RecipientSuggestionListProps) {
    const backgroundColor = useThemeColor('background')
    const borderColor = useThemeColor('border')
    const hoverBgColor = useThemeColor('surface-secondary')

    if (suggestions.length === 0) return null

    return (
        <View
            className="absolute border rounded-lg overflow-hidden"
            style={{
                top: '100%',
                left: 0,
                right: 0,
                zIndex: 2000,
                marginTop: 2,
                borderColor,
                backgroundColor,
                ...webShadow,
            }}
        >
            <ScrollView style={{ maxHeight: 250 }} keyboardShouldPersistTaps="handled">
                {suggestions.map((contact) => {
                    const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(' ')

                    return (
                        <Pressable
                            key={contact.id}
                            onPress={() => onSelect(contact)}
                            style={({ pressed }) => ({
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 8,
                                paddingHorizontal: 12,
                                paddingVertical: 8,
                                backgroundColor: pressed ? hoverBgColor : backgroundColor,
                                cursor: 'pointer' as 'auto',
                            })}
                        >
                            <ContactAvatar firstName={contact.first_name} lastName={contact.last_name} size={32} />
                            <View className="flex-1" style={{ gap: 2 }}>
                                <HighlightText text={fullName} query={query} bold />
                                <HighlightText text={contact.email ?? ''} query={query} />
                            </View>
                        </Pressable>
                    )
                })}
            </ScrollView>
        </View>
    )
}
