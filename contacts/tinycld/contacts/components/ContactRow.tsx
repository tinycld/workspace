import { rowFocusStyle } from '@tinycld/core/components/focusable-row'
import { HoverAction } from '@tinycld/core/components/HoverAction'
import { LabelDots } from '@tinycld/core/components/LabelBadge'
import { RowHoverActions } from '@tinycld/core/components/RowHoverActions'
import { StarIcon } from '@tinycld/core/components/StarIcon'
import { ConfirmTrash } from '@tinycld/core/components/SuretyGuard'
import { SwipeableRow } from '@tinycld/core/components/SwipeableRow'
import { useBreakpoint } from '@tinycld/core/components/workspace/useBreakpoint'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useRouter } from 'expo-router'
import { Edit3, RotateCcw, Star, Trash2 } from 'lucide-react-native'
import { useRecyclingState } from '@shopify/flash-list'
import { Platform, Pressable, Text, View } from 'react-native'
import { ContactAvatar } from './ContactAvatar'

interface ContactRowProps {
    contact: {
        id: string
        first_name: string
        last_name: string
        email: string
        phone: string
        favorite: boolean
    }
    labels: { id: string; name: string; color: string }[]
    onToggleFavorite: () => void
    onDelete: () => void
    onRestore?: () => void
    onPermanentDelete?: () => void
    index?: number
    isFocused?: boolean
}

export function ContactRow({
    contact,
    labels,
    onToggleFavorite,
    onDelete,
    onRestore,
    onPermanentDelete,
    index,
    isFocused,
}: ContactRowProps) {
    const router = useRouter()
    const orgHref = useOrgHref()
    const [isHovered, setIsHovered] = useRecyclingState(false, [contact.id])
    const borderColor = useThemeColor('border')
    const activeIndicator = useThemeColor('active-indicator')
    const warningColor = useThemeColor('warning')
    const dangerColor = useThemeColor('danger')
    const successColor = useThemeColor('success')
    const infoColor = useThemeColor('info')

    const displayName = [contact.first_name, contact.last_name].filter(Boolean).join(' ')

    const hoverWebProps =
        Platform.OS === 'web'
            ? {
                  onMouseEnter: () => setIsHovered(true),
                  onMouseLeave: () => setIsHovered(false),
              }
            : {}

    const tooltipPosition = index === 0 ? ('below' as const) : ('above' as const)

    const navigateToContact = onRestore ? undefined : () => router.push(orgHref('contacts/[id]', { id: contact.id }))

    const isCompact = useBreakpoint() === 'mobile'

    const isTrashView = Boolean(onRestore)

    const swipeActions = isTrashView
        ? [
              {
                  icon: RotateCcw,
                  label: 'Restore',
                  onPress: () => onRestore?.(),
                  backgroundColor: successColor,
              },
              {
                  icon: Trash2,
                  label: 'Delete',
                  onPress: () => onPermanentDelete?.(),
                  backgroundColor: dangerColor,
              },
          ]
        : [
              {
                  icon: Trash2,
                  label: 'Delete',
                  onPress: onDelete,
                  backgroundColor: dangerColor,
              },
              {
                  icon: Edit3,
                  label: 'Edit',
                  onPress: () => navigateToContact?.(),
                  backgroundColor: infoColor,
              },
              {
                  icon: Star,
                  label: contact.favorite ? 'Unstar' : 'Star',
                  onPress: onToggleFavorite,
                  backgroundColor: warningColor,
              },
          ]

    const effectStyle = rowFocusStyle({ isFocused, isHovered, borderColor, activeIndicator })

    const row = (
        <Pressable onPress={navigateToContact} {...hoverWebProps} style={{ width: '100%' }}>
            <View
                className="flex-row items-center pr-1 py-3 gap-2 border-b border-border bg-background"
                style={[
                    {
                        width: '100%',
                        paddingLeft: isCompact ? 4 : 12,
                    },
                    effectStyle,
                ]}
            >
                {/* Avatar lives in a fixed-width leading column on both
                    breakpoints so the flex-tracked columns (which the header
                    also uses) start at the same offset for header and row. */}
                <View style={{ width: 52, alignItems: 'flex-start' }}>
                    <ContactAvatar firstName={contact.first_name} lastName={contact.last_name} />
                </View>
                {isCompact ? (
                    <View className="flex-1 flex-row items-center gap-2 min-w-0">
                        <View className="flex-1 gap-0.5 min-w-0">
                            <Text
                                className="text-base font-medium text-foreground"
                                numberOfLines={1}
                            >
                                {displayName}
                            </Text>
                            <Text
                                className="text-xs text-muted-foreground"
                                numberOfLines={1}
                            >
                                {[contact.email, contact.phone].filter(Boolean).join(' · ')}
                            </Text>
                        </View>
                        {labels.length > 0 ? <LabelDots labels={labels} max={3} /> : null}
                    </View>
                ) : (
                    <>
                        <Text
                            className="text-base font-medium text-foreground"
                            style={{ flex: 2, flexBasis: 0, minWidth: 0 }}
                            numberOfLines={1}
                        >
                            {displayName}
                        </Text>
                        <Text
                            className="text-sm text-muted-foreground"
                            style={{ flex: 2, flexBasis: 0, minWidth: 0 }}
                            numberOfLines={1}
                        >
                            {contact.email}
                        </Text>
                        <View
                            className="flex-row items-center gap-2"
                            style={{ flex: 1, flexBasis: 0, minWidth: 0 }}
                        >
                            <Text
                                className="text-sm text-muted-foreground"
                                style={{ flex: 1, minWidth: 0 }}
                                numberOfLines={1}
                            >
                                {contact.phone}
                            </Text>
                            {labels.length > 0 ? <LabelDots labels={labels} max={3} /> : null}
                        </View>
                    </>
                )}
                {isCompact ? (
                    // Mobile keeps just the static star; swipe gestures handle
                    // the destructive actions via SwipeableRow above.
                    onRestore ? null : (
                        <Pressable
                            className="p-1"
                            onPress={(e) => {
                                e.stopPropagation()
                                onToggleFavorite()
                            }}
                        >
                            <StarIcon isStarred={contact.favorite} size={18} />
                        </Pressable>
                    )
                ) : (
                    <RowHoverActions
                        isHovered={isHovered}
                        rest={
                            onRestore ? null : (
                                <Pressable
                                    className="p-1"
                                    onPress={(e) => {
                                        e.stopPropagation()
                                        onToggleFavorite()
                                    }}
                                >
                                    <StarIcon isStarred={contact.favorite} size={18} />
                                </Pressable>
                            )
                        }
                        hover={
                            onRestore && onPermanentDelete ? (
                                <>
                                    <HoverAction
                                        icon={RotateCcw}
                                        label="Restore"
                                        onPress={onRestore}
                                        tooltipPosition={tooltipPosition}
                                    />
                                    <ConfirmTrash itemName={displayName} onConfirmed={onPermanentDelete}>
                                        {(onOpen) => (
                                            <HoverAction
                                                icon={Trash2}
                                                label="Delete permanently"
                                                onPress={onOpen}
                                                tooltipPosition={tooltipPosition}
                                            />
                                        )}
                                    </ConfirmTrash>
                                </>
                            ) : (
                                <>
                                    <ConfirmTrash itemName={displayName} onConfirmed={onDelete}>
                                        {(onOpen) => (
                                            <HoverAction
                                                icon={Trash2}
                                                label="Delete"
                                                onPress={onOpen}
                                                tooltipPosition={tooltipPosition}
                                            />
                                        )}
                                    </ConfirmTrash>
                                    <HoverAction
                                        icon={Edit3}
                                        label="Edit"
                                        onPress={() => navigateToContact?.()}
                                        tooltipPosition={tooltipPosition}
                                    />
                                    <HoverAction
                                        icon={Star}
                                        label={contact.favorite ? 'Unstar' : 'Star'}
                                        onPress={onToggleFavorite}
                                        iconColor="#facc15"
                                        iconFill={contact.favorite ? '#facc15' : 'transparent'}
                                        tooltipPosition={tooltipPosition}
                                    />
                                </>
                            )
                        }
                    />
                )}
            </View>
        </Pressable>
    )

    if (isCompact) {
        return <SwipeableRow actions={swipeActions}>{row}</SwipeableRow>
    }

    return row
}
