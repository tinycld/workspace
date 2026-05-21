import { formatBytes } from '@tinycld/core/lib/format-utils'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { X } from 'lucide-react-native'
import { Pressable, ScrollView, Text, View } from 'react-native'
import type { AttachmentFile } from '../hooks/useAttachments'

interface AttachmentRibbonProps {
    isVisible: boolean
    attachments: AttachmentFile[]
    onRemove: (id: string) => void
}

export function AttachmentRibbon({ isVisible, attachments, onRemove }: AttachmentRibbonProps) {
    const borderColor = useThemeColor('border')

    if (!isVisible) return null

    return (
        <View
            className="px-3"
            style={{
                borderTopWidth: 1,
                borderTopColor: borderColor,
                paddingVertical: 6,
            }}
        >
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
                <View className="flex-row" style={{ gap: 6 }}>
                    {attachments.map((att) => (
                        <AttachmentChip key={att.id} attachment={att} onRemove={() => onRemove(att.id)} />
                    ))}
                </View>
            </ScrollView>
        </View>
    )
}

function AttachmentChip({ attachment, onRemove }: { attachment: AttachmentFile; onRemove: () => void }) {
    const foregroundColor = useThemeColor('foreground')
    const mutedColor = useThemeColor('muted-foreground')
    const surfaceColor = useThemeColor('surface-secondary')
    const borderColor = useThemeColor('border')

    const truncatedName = attachment.name.length > 24 ? `${attachment.name.slice(0, 21)}...` : attachment.name

    return (
        <View
            className="flex-row items-center gap-1 px-2 py-1 rounded-md border"
            style={{
                backgroundColor: surfaceColor,
                borderColor,
            }}
        >
            <Text
                style={{
                    fontSize: 12,
                    fontWeight: '500',
                    maxWidth: 160,
                    color: foregroundColor,
                }}
                numberOfLines={1}
            >
                {truncatedName}
            </Text>
            <Text style={{ fontSize: 11, color: mutedColor }}>{formatBytes(attachment.size)}</Text>
            <Pressable onPress={onRemove} className="p-0.5" hitSlop={4}>
                <X size={12} color={mutedColor} />
            </Pressable>
        </View>
    )
}
