import { ResponsiveToolbar, type ToolbarItem } from '@tinycld/core/components/ResponsiveToolbar'
import type { EditorCommands, EditorToolbarState } from '@tinycld/core/lib/editor/types'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Bold, Italic, Link2, List, ListOrdered, Paperclip, Quote, Trash2, Underline } from 'lucide-react-native'
import { useCallback, useMemo } from 'react'
import { ActivityIndicator, Alert, Platform, Pressable, Text, View } from 'react-native'

interface ComposeToolbarProps {
    commands: EditorCommands
    toolbarState: EditorToolbarState
    onDiscard: () => void
    onSend: () => void
    onAttach?: () => void
    isPending: boolean
    isSendDisabled?: boolean
}

export function ComposeToolbar({
    commands,
    toolbarState,
    onDiscard,
    onSend,
    onAttach,
    isPending,
    isSendDisabled = false,
}: ComposeToolbarProps) {
    const iconColor = useThemeColor('muted-foreground')
    const activeColor = useThemeColor('primary')
    const primaryFgColor = useThemeColor('primary-foreground')

    const handleLink = useCallback(() => {
        const defaultUrl = toolbarState.currentLink ?? 'https://'

        if (Platform.OS === 'web') {
            const url = window.prompt('Enter URL:', defaultUrl)
            if (url !== null) {
                if (url) {
                    commands.setLink(url)
                } else {
                    commands.removeLink()
                }
            }
        } else {
            Alert.prompt(
                'Insert Link',
                'Enter URL:',
                (url) => {
                    if (url !== null) {
                        if (url) {
                            commands.setLink(url)
                        } else {
                            commands.removeLink()
                        }
                    }
                },
                'plain-text',
                defaultUrl
            )
        }
    }, [commands, toolbarState.currentLink])

    const items: ToolbarItem[] = useMemo(
        () => [
            {
                type: 'custom',
                key: 'send',
                element: (
                    <Pressable
                        className="rounded-full items-center bg-primary"
                        style={[
                            {
                                paddingHorizontal: 20,
                                paddingVertical: 6,
                                minWidth: 72,
                            },
                            (isPending || isSendDisabled) && { opacity: 0.6 },
                        ]}
                        onPress={onSend}
                        disabled={isPending || isSendDisabled}
                    >
                        {isPending ? (
                            <ActivityIndicator size="small" color={primaryFgColor} />
                        ) : (
                            <Text className="text-primary-foreground" style={{ fontSize: 14, fontWeight: '600' }}>
                                Send
                            </Text>
                        )}
                    </Pressable>
                ),
            },
            {
                type: 'custom',
                key: 'bold',
                element: (
                    <FormatButton
                        icon={Bold}
                        isActive={toolbarState.isBoldActive}
                        onPress={() => commands.toggleBold()}
                        iconColor={iconColor}
                        activeColor={activeColor}
                    />
                ),
                overflowLabel: 'Bold',
                overflowIcon: Bold,
                overflowPress: () => commands.toggleBold(),
            },
            {
                type: 'custom',
                key: 'italic',
                element: (
                    <FormatButton
                        icon={Italic}
                        isActive={toolbarState.isItalicActive}
                        onPress={() => commands.toggleItalic()}
                        iconColor={iconColor}
                        activeColor={activeColor}
                    />
                ),
                overflowLabel: 'Italic',
                overflowIcon: Italic,
                overflowPress: () => commands.toggleItalic(),
            },
            {
                type: 'custom',
                key: 'underline',
                element: (
                    <FormatButton
                        icon={Underline}
                        isActive={toolbarState.isUnderlineActive}
                        onPress={() => commands.toggleUnderline()}
                        iconColor={iconColor}
                        activeColor={activeColor}
                    />
                ),
                overflowLabel: 'Underline',
                overflowIcon: Underline,
                overflowPress: () => commands.toggleUnderline(),
            },
            { type: 'separator' },
            {
                type: 'custom',
                key: 'bullet-list',
                element: (
                    <FormatButton
                        icon={List}
                        isActive={toolbarState.isBulletListActive}
                        onPress={() => commands.toggleBulletList()}
                        iconColor={iconColor}
                        activeColor={activeColor}
                    />
                ),
                overflowLabel: 'Bullet list',
                overflowIcon: List,
                overflowPress: () => commands.toggleBulletList(),
            },
            {
                type: 'custom',
                key: 'ordered-list',
                element: (
                    <FormatButton
                        icon={ListOrdered}
                        isActive={toolbarState.isOrderedListActive}
                        onPress={() => commands.toggleOrderedList()}
                        iconColor={iconColor}
                        activeColor={activeColor}
                    />
                ),
                overflowLabel: 'Numbered list',
                overflowIcon: ListOrdered,
                overflowPress: () => commands.toggleOrderedList(),
            },
            { type: 'separator' },
            {
                type: 'custom',
                key: 'blockquote',
                element: (
                    <FormatButton
                        icon={Quote}
                        isActive={toolbarState.isBlockquoteActive}
                        onPress={() => commands.toggleBlockquote()}
                        iconColor={iconColor}
                        activeColor={activeColor}
                    />
                ),
                overflowLabel: 'Blockquote',
                overflowIcon: Quote,
                overflowPress: () => commands.toggleBlockquote(),
            },
            {
                type: 'custom',
                key: 'link',
                element: (
                    <FormatButton
                        icon={Link2}
                        isActive={toolbarState.isLinkActive}
                        onPress={handleLink}
                        iconColor={iconColor}
                        activeColor={activeColor}
                    />
                ),
                overflowLabel: 'Link',
                overflowIcon: Link2,
                overflowPress: handleLink,
            },
            { type: 'separator' },
            {
                type: 'button',
                key: 'attach',
                icon: Paperclip,
                label: 'Attach',
                onPress: onAttach ?? (() => {}),
            },
        ],
        [
            primaryFgColor,
            isPending,
            isSendDisabled,
            onSend,
            commands,
            toolbarState,
            iconColor,
            activeColor,
            handleLink,
            onAttach,
        ]
    )

    const rightItems: ToolbarItem[] = useMemo(
        () => [{ type: 'button', key: 'discard', icon: Trash2, label: 'Discard', onPress: onDiscard }],
        [onDiscard]
    )

    return (
        <View className="border-t border-border">
            <ResponsiveToolbar items={items} rightItems={rightItems} />
        </View>
    )
}

interface FormatButtonProps {
    icon: React.ComponentType<{ size: number; color: string }>
    isActive: boolean
    onPress: () => void
    iconColor: string
    activeColor: string
}

function FormatButton({ icon: Icon, isActive, onPress, iconColor, activeColor }: FormatButtonProps) {
    return (
        <Pressable
            className="rounded-md p-1.5"
            style={isActive ? { backgroundColor: `${activeColor}22` } : undefined}
            onPress={onPress}
        >
            <Icon size={16} color={isActive ? activeColor : iconColor} />
        </Pressable>
    )
}
