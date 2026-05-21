import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Search } from 'lucide-react-native'
import { Platform, Pressable, Text, TextInput, View } from 'react-native'
import type { TypeFilter } from '../hooks/filterMailboxes'

interface Props {
    query: string
    onQueryChange: (next: string) => void
    type: TypeFilter
    onTypeChange: (next: TypeFilter) => void
    counts: { all: number; shared: number; personal: number }
}

const SEGMENTS: Array<{ value: TypeFilter; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'shared', label: 'Shared' },
    { value: 'personal', label: 'Personal' },
]

export function MailboxSearchBar({ query, onQueryChange, type, onTypeChange, counts }: Props) {
    const borderColor = useThemeColor('border')
    const mutedColor = useThemeColor('muted-foreground')
    const fgColor = useThemeColor('foreground')
    const primaryColor = useThemeColor('primary')
    const bgColor = useThemeColor('background')

    return (
        <View className="flex-row gap-2 items-center flex-wrap">
            <View
                className="flex-row gap-2 items-center flex-1 rounded-lg px-3"
                style={{
                    borderWidth: 1,
                    borderColor,
                    paddingVertical: 8,
                    backgroundColor: bgColor,
                    minWidth: 200,
                }}
            >
                <Search size={14} color={mutedColor} />
                <TextInput
                    value={query}
                    onChangeText={onQueryChange}
                    placeholder="Search address, display name, or member…"
                    placeholderTextColor={mutedColor}
                    style={{
                        flex: 1,
                        color: fgColor,
                        fontSize: 13,
                        padding: 0,
                        ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as Record<string, unknown>) : {}),
                    }}
                    autoCorrect={false}
                    autoCapitalize="none"
                />
            </View>
            <View className="flex-row rounded-lg overflow-hidden border border-border">
                {SEGMENTS.map((seg) => {
                    const isActive = type === seg.value
                    const count = counts[seg.value]
                    return (
                        <Pressable
                            key={seg.value}
                            onPress={() => onTypeChange(seg.value)}
                            style={{
                                paddingVertical: 7,
                                paddingHorizontal: 12,
                                backgroundColor: isActive ? bgColor : 'transparent',
                                borderBottomWidth: isActive ? 2 : 0,
                                borderBottomColor: primaryColor,
                            }}
                        >
                            <Text
                                style={{
                                    fontSize: 13,
                                    fontWeight: isActive ? '600' : '500',
                                    color: isActive ? fgColor : mutedColor,
                                }}
                            >
                                {seg.label}{' '}
                                <Text
                                    style={{
                                        color: isActive ? primaryColor : mutedColor,
                                        fontWeight: '500',
                                    }}
                                >
                                    {count}
                                </Text>
                            </Text>
                        </Pressable>
                    )
                })}
            </View>
        </View>
    )
}
