import { LabelBadge } from '@tinycld/core/components/LabelBadge'
import { StarIcon } from '@tinycld/core/components/StarIcon'
import { ToolbarIconButton } from '@tinycld/core/components/ToolbarIconButton'
import { useBreakpoint } from '@tinycld/core/components/workspace/useBreakpoint'
import { hexToRgba } from '@tinycld/core/lib/color-utils'
import { formatRelativeDate } from '@tinycld/core/lib/format-utils'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { ChevronDown, ChevronUp, Forward, MoreVertical, Reply, ReplyAll } from 'lucide-react-native'
import { Platform, Pressable, Text, View } from 'react-native'
import { MenuActionItem, ToolbarMenu } from './DropdownMenu'

function Tooltip({ title, children }: { title: string; children: React.ReactNode }) {
    if (Platform.OS !== 'web') return <>{children}</>
    return (
        <div title={title} style={{ display: 'inline-flex' }}>
            {children}
        </div>
    )
}

interface ThreadSubjectHeaderProps {
    subject: string
    labels: { id: string; name: string; color: string }[]
}

export function ThreadSubjectHeader({ subject, labels }: ThreadSubjectHeaderProps) {
    const breakpoint = useBreakpoint()
    const isMobile = breakpoint === 'mobile'
    const foregroundColor = useThemeColor('foreground')

    return (
        <View className="flex-row items-center gap-2 px-4 py-3 flex-wrap">
            <Text style={{ fontSize: isMobile ? 18 : 22, fontWeight: '400', color: foregroundColor }}>{subject}</Text>
            <View className="flex-row gap-1">
                {labels.map((label) => (
                    <LabelBadge key={label.id} name={label.name} color={label.color} />
                ))}
            </View>
        </View>
    )
}

function DeliveryStatusBadge({ status, bounceReason }: { status?: string; bounceReason?: string }) {
    const dangerColor = useThemeColor('danger')
    const warningColor = useThemeColor('warning')

    if (!status || status === 'sent' || status === 'delivered' || status === 'sending') return null

    const isBounce = status === 'bounced'
    const backgroundColor = isBounce ? hexToRgba(dangerColor, 0.15) : hexToRgba(warningColor, 0.15)
    const textColor = isBounce ? dangerColor : warningColor
    const label = isBounce ? 'Bounced' : 'Spam complaint'

    return (
        <View
            className="flex-row items-center mx-4 mb-2 py-1 rounded self-start"
            style={{
                gap: 6,
                paddingHorizontal: 10,
                backgroundColor,
            }}
        >
            <Text style={{ fontSize: 12, fontWeight: '600', color: textColor }}>{label}</Text>
            {bounceReason ? (
                <Text style={{ fontSize: 11, flexShrink: 1, color: textColor }} numberOfLines={1}>
                    {bounceReason}
                </Text>
            ) : null}
        </View>
    )
}

interface MessageHeaderProps {
    senderName: string
    senderEmail: string
    date: string
    isStarred?: boolean
    deliveryStatus?: string
    bounceReason?: string
    isExpanded: boolean
    onToggleExpand: () => void
    onReply?: () => void
    onReplyAll?: () => void
    onForward?: () => void
    onToggleStar?: () => void
}

export function MessageHeader({
    senderName,
    senderEmail,
    date,
    isStarred,
    deliveryStatus,
    bounceReason,
    isExpanded,
    onToggleExpand,
    onReply,
    onReplyAll,
    onForward,
    onToggleStar,
}: MessageHeaderProps) {
    const foregroundColor = useThemeColor('foreground')
    const mutedColor = useThemeColor('muted-foreground')
    const borderColor = useThemeColor('border')
    const accentBgColor = useThemeColor('accent')
    const accentFgColor = useThemeColor('accent-foreground')
    const breakpoint = useBreakpoint()
    const isMobile = breakpoint === 'mobile'

    const initials = senderName
        .split(' ')
        .filter(Boolean)
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)

    const dateDisplay = formatRelativeDate(date)

    return (
        <View style={{ gap: 0 }}>
            <DeliveryStatusBadge status={deliveryStatus} bounceReason={bounceReason} />
            <Pressable onPress={onToggleExpand}>
                <View
                    className="flex-row items-center px-4 py-3 gap-2"
                    style={{
                        borderBottomWidth: 1,
                        borderBottomColor: borderColor,
                    }}
                >
                    <View
                        className="size-10 rounded-full items-center justify-center"
                        style={{
                            backgroundColor: accentBgColor,
                        }}
                    >
                        <Text style={{ fontSize: 14, fontWeight: '600', color: accentFgColor }}>{initials}</Text>
                    </View>
                    <View className="flex-1" style={{ gap: 2 }}>
                        <View className="flex-row items-center gap-1">
                            <Text style={{ fontSize: 14, fontWeight: '600', color: foregroundColor }}>
                                {senderName}
                            </Text>
                            {isMobile ? null : (
                                <Text style={{ fontSize: 12, color: mutedColor }}>
                                    {'<'}
                                    {senderEmail}
                                    {'>'}
                                </Text>
                            )}
                        </View>
                        <Text style={{ fontSize: 12, color: mutedColor }}>to me</Text>
                    </View>
                    <Text style={{ fontSize: 12, flexShrink: 0, color: mutedColor }}>{dateDisplay}</Text>
                    {isStarred != null ? (
                        <Tooltip title={isStarred ? 'Remove star' : 'Add star'}>
                            <Pressable className="rounded-full" style={{ padding: 6 }} onPress={onToggleStar}>
                                <StarIcon isStarred={!!isStarred} size={18} />
                            </Pressable>
                        </Tooltip>
                    ) : null}
                    <ToolbarIconButton icon={Reply} label="Reply" onPress={onReply} />
                    <Tooltip title={isExpanded ? 'Collapse' : 'Expand'}>
                        <Pressable className="rounded-full" style={{ padding: 6 }} onPress={onToggleExpand}>
                            {isExpanded ? (
                                <ChevronUp size={18} color={mutedColor} />
                            ) : (
                                <ChevronDown size={18} color={mutedColor} />
                            )}
                        </Pressable>
                    </Tooltip>
                    <ToolbarMenu icon={MoreVertical} label="More options">
                        <MenuActionItem label="Reply" icon={Reply} onPress={onReply ?? (() => {})} />
                        <MenuActionItem label="Reply all" icon={ReplyAll} onPress={onReplyAll ?? (() => {})} />
                        <MenuActionItem label="Forward" icon={Forward} onPress={onForward ?? (() => {})} />
                    </ToolbarMenu>
                </View>
            </Pressable>
        </View>
    )
}
