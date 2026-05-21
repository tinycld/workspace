import { rowFocusStyle } from '@tinycld/core/components/focusable-row'
import { HoverAction } from '@tinycld/core/components/HoverAction'
import { LabelBadge, LabelDots } from '@tinycld/core/components/LabelBadge'
import { RowHoverActions } from '@tinycld/core/components/RowHoverActions'
import { StarIcon } from '@tinycld/core/components/StarIcon'
import { SwipeableRow } from '@tinycld/core/components/SwipeableRow'
import { hexToRgba } from '@tinycld/core/lib/color-utils'
import { formatRelativeDate } from '@tinycld/core/lib/format-utils'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import type { Href } from 'expo-router'
import { Link } from 'expo-router'
import { Archive, Inbox, Mail, MailOpen, Paperclip, Square, SquareCheck, Trash2 } from 'lucide-react-native'
import { useRecyclingState } from '@shopify/flash-list'
import type { ReactNode } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import type { ThreadListItem } from './thread-list-item'

function MailboxChip({ label }: { label: string }) {
    const mutedColor = useThemeColor('muted-foreground')
    const borderColor = useThemeColor('border')
    return (
        <View
            className="flex-row px-1.5 rounded shrink-0"
            style={{
                paddingVertical: 1,
                borderWidth: 1,
                borderColor,
            }}
        >
            <Text style={{ fontSize: 11, fontWeight: '500', color: mutedColor }} numberOfLines={1}>
                {label}
            </Text>
        </View>
    )
}

interface EmailRowProps {
    email: ThreadListItem
    isMobile?: boolean
    onToggleStar?: () => void
    isSelected?: boolean
    onToggleSelect?: () => void
    onPress?: () => void
    onArchive?: () => void
    onTrash?: () => void
    onToggleRead?: () => void
    index?: number
    isFocused?: boolean
}

export function EmailRow({
    email,
    isMobile,
    onToggleStar,
    isSelected,
    onToggleSelect,
    onPress,
    onArchive,
    onTrash,
    onToggleRead,
    index,
    isFocused,
}: EmailRowProps) {
    if (isMobile)
        return (
            <MobileEmailRow
                email={email}
                onToggleStar={onToggleStar}
                onPress={onPress}
                onArchive={onArchive}
                onTrash={onTrash}
                onToggleRead={onToggleRead}
                index={index}
            />
        )
    return (
        <DesktopEmailRow
            email={email}
            onToggleStar={onToggleStar}
            isSelected={isSelected}
            onToggleSelect={onToggleSelect}
            onPress={onPress}
            onArchive={onArchive}
            onTrash={onTrash}
            onToggleRead={onToggleRead}
            index={index}
            isFocused={isFocused}
        />
    )
}

function RowWrapper({
    href,
    onPress,
    testID,
    children,
}: { href: Href; onPress?: () => void; testID?: string; children: ReactNode }) {
    if (onPress) {
        return (
            <Pressable onPress={onPress} testID={testID} className="flex w-full">
                {children}
            </Pressable>
        )
    }
    return (
        <Link href={href} testID={testID} className="flex w-full">
            {children}
        </Link>
    )
}

function SenderWithDraft({
    email,
    dangerColor,
    style,
    numberOfLines,
}: {
    email: ThreadListItem
    dangerColor: string
    style: Record<string, unknown>[]
    numberOfLines?: number
}) {
    if (!email.hasDraft) {
        return (
            <Text style={style} numberOfLines={numberOfLines}>
                {email.senderName}
            </Text>
        )
    }

    const otherParticipants = email.participants
        .filter((p) => p.email !== email.senderEmail)
        .map((p) => p.name || p.email.split('@')[0])

    if (otherParticipants.length === 0) {
        return (
            <Text style={style} numberOfLines={numberOfLines}>
                <Text style={{ color: dangerColor }}>Draft</Text>
            </Text>
        )
    }

    return (
        <Text style={style} numberOfLines={numberOfLines}>
            {otherParticipants.join(', ')}, <Text style={{ color: dangerColor }}>Draft</Text>
        </Text>
    )
}

function MobileEmailRow({ email, onToggleStar, onPress, onArchive, onTrash, onToggleRead, index }: EmailRowProps) {
    const foregroundColor = useThemeColor('foreground')
    const mutedColor = useThemeColor('muted-foreground')
    const backgroundColor = useThemeColor('background')
    const surfaceColor = useThemeColor('surface-secondary')
    const borderColor = useThemeColor('border')
    const accentBgColor = useThemeColor('accent')
    const accentFgColor = useThemeColor('accent-foreground')
    const dangerColor = useThemeColor('danger')
    const infoColor = useThemeColor('info')
    const successColor = useThemeColor('success')
    const orgHref = useOrgHref()

    const senderWeight = email.isRead ? ('400' as const) : ('700' as const)
    const subjectWeight = email.isRead ? ('400' as const) : ('600' as const)
    const rowBg = email.isRead ? backgroundColor : surfaceColor

    const displayName = email.hasDraft ? 'Draft' : email.senderName
    const initials = displayName
        .split(' ')
        .filter(Boolean)
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)

    const dateDisplay = formatRelativeDate(email.latestDate)

    const isTrashed = email.folder === 'trash'
    const isArchived = email.folder === 'archive'
    const swipeActions = [
        {
            icon: isArchived ? Inbox : Archive,
            label: isArchived ? 'Inbox' : 'Archive',
            onPress: () => onArchive?.(),
            backgroundColor: infoColor,
        },
        {
            icon: isTrashed ? Inbox : Trash2,
            label: isTrashed ? 'Inbox' : 'Trash',
            onPress: () => onTrash?.(),
            backgroundColor: dangerColor,
        },
        {
            icon: email.isRead ? Mail : MailOpen,
            label: email.isRead ? 'Unread' : 'Read',
            onPress: () => onToggleRead?.(),
            backgroundColor: successColor,
        },
    ]

    return (
        <SwipeableRow actions={swipeActions}>
            <RowWrapper
                href={orgHref('mail/[id]', { id: email.threadId })}
                onPress={onPress}
                testID={index !== undefined ? `mail-thread-row-${index}` : undefined}
            >
                <View
                    style={[
                        mobileStyles.row,
                        {
                            backgroundColor: rowBg,
                            borderBottomColor: borderColor,
                        },
                    ]}
                >
                    <View style={[mobileStyles.avatar, { backgroundColor: accentBgColor }]}>
                        <Text style={[mobileStyles.avatarText, { color: accentFgColor }]}>{initials}</Text>
                    </View>
                    <View style={mobileStyles.content}>
                        <View style={mobileStyles.topRow}>
                            <SenderWithDraft
                                email={email}
                                dangerColor={dangerColor}
                                style={[mobileStyles.sender, { color: foregroundColor, fontWeight: senderWeight }]}
                                numberOfLines={1}
                            />
                            {email.mailboxLabel ? <MailboxChip label={email.mailboxLabel} /> : null}
                            {email.hasAttachments ? <Paperclip size={14} color={mutedColor} /> : null}
                            <Text style={[mobileStyles.date, { color: mutedColor }]}>{dateDisplay}</Text>
                            <Pressable
                                style={mobileStyles.starButton}
                                onPress={(e) => {
                                    e.stopPropagation()
                                    e.preventDefault()
                                    onToggleStar?.()
                                }}
                            >
                                <StarIcon isStarred={email.isStarred} />
                            </Pressable>
                        </View>
                        <Text
                            style={[mobileStyles.subject, { color: foregroundColor, fontWeight: subjectWeight }]}
                            numberOfLines={1}
                        >
                            {email.subject}
                        </Text>
                        <Text style={[mobileStyles.preview, { color: mutedColor }]} numberOfLines={2}>
                            {email.snippet}
                        </Text>
                        {email.labels.length > 0 ? (
                            <View style={mobileStyles.labelRow}>
                                {email.labels.slice(0, 3).map((label) => (
                                    <LabelBadge key={label.id} name={label.name} color={label.color} />
                                ))}
                            </View>
                        ) : null}
                    </View>
                </View>
            </RowWrapper>
        </SwipeableRow>
    )
}

function EmailRowActions({
    email,
    isSelected,
    onArchive,
    onTrash,
    onToggleRead,
    tooltipPosition = 'above',
}: Pick<EmailRowProps, 'email' | 'isSelected' | 'onArchive' | 'onTrash' | 'onToggleRead'> & {
    tooltipPosition?: 'above' | 'below'
}) {
    const accentBgColor = useThemeColor('accent')
    const backgroundColor = useThemeColor('background')
    const ReadIcon = email.isRead ? Mail : MailOpen
    const bg = isSelected ? hexToRgba(accentBgColor, 0.09) : backgroundColor

    const isTrashed = email.folder === 'trash'
    const isArchived = email.folder === 'archive'
    const ArchiveIcon = isArchived ? Inbox : Archive
    const archiveLabel = isArchived ? 'Move to Inbox' : 'Archive'

    return (
        <View
            className="flex-row items-center ml-2 shrink-0"
            style={{
                backgroundColor: bg,
            }}
        >
            <HoverAction
                icon={ArchiveIcon}
                label={archiveLabel}
                onPress={onArchive}
                tooltipPosition={tooltipPosition}
            />
            <HoverAction
                icon={isTrashed ? Inbox : Trash2}
                label={isTrashed ? 'Move to Inbox' : 'Delete'}
                onPress={onTrash}
                tooltipPosition={tooltipPosition}
            />
            <HoverAction
                icon={ReadIcon}
                label={email.isRead ? 'Mark as unread' : 'Mark as read'}
                onPress={onToggleRead}
                tooltipPosition={tooltipPosition}
            />
        </View>
    )
}

function DesktopEmailRow({
    email,
    onToggleStar,
    isSelected,
    onToggleSelect,
    onPress,
    onArchive,
    onTrash,
    onToggleRead,
    index,
    isFocused,
}: EmailRowProps) {
    const foregroundColor = useThemeColor('foreground')
    const mutedColor = useThemeColor('muted-foreground')
    const surfaceColor = useThemeColor('surface-secondary')
    const borderColor = useThemeColor('border')
    const accentBgColor = useThemeColor('accent')
    const activeIndicator = useThemeColor('active-indicator')
    const dangerColor = useThemeColor('danger')
    const orgHref = useOrgHref()
    const [isHovered, setIsHovered] = useRecyclingState(false, [email.stateId])

    const rowBg = isSelected ? hexToRgba(accentBgColor, 0.09) : email.isRead ? 'transparent' : surfaceColor
    const senderWeight = email.isRead ? '400' : '700'
    const subjectWeight = email.isRead ? '400' : '600'
    const dateDisplay = formatRelativeDate(email.latestDate)

    const primaryColor = useThemeColor('primary')
    const CheckboxIcon = isSelected ? SquareCheck : Square
    const checkboxColor = isSelected ? primaryColor : mutedColor

    const hoverWebProps =
        Platform.OS === 'web'
            ? {
                  onMouseEnter: () => setIsHovered(true),
                  onMouseLeave: () => setIsHovered(false),
              }
            : {}

    const effectStyle = rowFocusStyle({ isFocused, isHovered, borderColor, activeIndicator })

    return (
        <RowWrapper
            href={orgHref('mail/[id]', { id: email.threadId })}
            onPress={onPress}
            testID={index !== undefined ? `mail-thread-row-${index}` : undefined}
        >
            <View
                style={[
                    styles.row,
                    {
                        backgroundColor: rowBg,
                        borderBottomColor: borderColor,
                    },
                    effectStyle,
                ]}
                {...hoverWebProps}
                testID="email-row"
            >
                <Pressable
                    style={styles.checkbox}
                    onPress={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        onToggleSelect?.()
                    }}
                >
                    <CheckboxIcon size={16} color={checkboxColor} />
                </Pressable>
                <Pressable
                    style={styles.starButton}
                    onPress={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        onToggleStar?.()
                    }}
                >
                    <StarIcon isStarred={email.isStarred} />
                </Pressable>
                <View style={styles.senderArea}>
                    <SenderWithDraft
                        email={email}
                        dangerColor={dangerColor}
                        style={[
                            styles.sender,
                            {
                                color: foregroundColor,
                                fontWeight: senderWeight as '400' | '700',
                            },
                        ]}
                        numberOfLines={1}
                    />
                    {email.messageCount > 1 ? (
                        <Text style={[styles.threadBadge, { color: mutedColor }]}>{email.messageCount}</Text>
                    ) : null}
                </View>
                {email.mailboxLabel ? <MailboxChip label={email.mailboxLabel} /> : null}
                <View style={styles.subjectArea}>
                    <Text
                        style={[styles.subject, { color: foregroundColor, fontWeight: subjectWeight as '400' | '600' }]}
                        numberOfLines={1}
                    >
                        {email.subject}
                    </Text>
                    <Text style={[styles.preview, { color: mutedColor }]} numberOfLines={1}>
                        {' \u2014 '}
                        {email.snippet}
                    </Text>
                </View>
                <RowHoverActions
                    isHovered={isHovered}
                    width={120}
                    backgroundColor={rowBg}
                    rest={
                        <View className="flex-row items-center" style={{ gap: 8 }}>
                            {email.labels.length > 0 ? <LabelDots labels={email.labels} max={3} /> : null}
                            {email.hasAttachments ? <Paperclip size={14} color={mutedColor} /> : null}
                            <Text style={[styles.date, { color: mutedColor }]}>{dateDisplay}</Text>
                        </View>
                    }
                    hover={
                        <EmailRowActions
                            email={email}
                            isSelected={isSelected}
                            onArchive={onArchive}
                            onTrash={onTrash}
                            onToggleRead={onToggleRead}
                            tooltipPosition={index === 0 ? 'below' : 'above'}
                        />
                    }
                />
            </View>
        </RowWrapper>
    )
}

const mobileStyles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingHorizontal: 12,
        paddingVertical: 12,
        borderBottomWidth: 1,
        gap: 12,
        flex: 1,
    },
    avatar: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    avatarText: {
        fontSize: 14,
        fontWeight: '600',
    },
    content: {
        flex: 1,
        gap: 2,
    },
    topRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    sender: {
        fontSize: 14,
        flex: 1,
    },
    date: {
        fontSize: 12,
        flexShrink: 0,
    },
    starButton: {
        padding: 2,
        flexShrink: 0,
    },
    subject: {
        fontSize: 13,
    },
    preview: {
        fontSize: 13,
        lineHeight: 18,
    },
    labelRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 4,
        marginTop: 2,
    },
})

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 40,
        paddingHorizontal: 8,
        borderBottomWidth: 1,
        gap: 4,
        flex: 1,
    },
    checkbox: {
        padding: 4,
    },
    starButton: {
        padding: 4,
    },
    senderArea: {
        flexDirection: 'row',
        alignItems: 'center',
        width: 160,
        flexShrink: 0,
        gap: 4,
    },
    sender: {
        fontSize: 13,
        flexShrink: 1,
    },
    threadBadge: {
        fontSize: 11,
        flexShrink: 0,
    },
    subjectArea: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        overflow: 'hidden',
    },
    subject: {
        fontSize: 13,
        flexShrink: 0,
    },
    preview: {
        fontSize: 13,
        flex: 1,
    },
    date: {
        fontSize: 12,
        flexShrink: 0,
        marginLeft: 8,
    },
})
