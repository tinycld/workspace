import type { EditorCommands, EditorToolbarState } from '@tinycld/core/lib/editor/types'
import { useEffect, useState } from 'react'
import { Keyboard, Pressable, Text, View } from 'react-native'

export const TEXT_INPUT_ACCESSORY_ID = 'tinycld-text-accessory'

interface MobileToolbarAccessoryProps {
    commands: EditorCommands
    toolbarState: EditorToolbarState
    editable: boolean
}

// iOS-only accessory bar that floats above the soft keyboard while the
// text editor's WebView has focus. Provides the most-used formatting
// commands (B / I / U / H1 / H2 / list / blockquote) so iPad users can
// format without dismissing the keyboard to reach the main toolbar.
//
// Why not InputAccessoryView? TenTap's RichText hides its own keyboard
// accessory view (`hideKeyboardAccessoryView={true}`) and the WebView
// content doesn't go through a standard RN TextInput, so iOS can't
// auto-associate an InputAccessoryView with the WebView's keyboard.
// Instead we listen for Keyboard show/hide events and render an
// absolutely-positioned bar that sits above the keyboard. Same UX
// outcome, works with TenTap's plumbing. Platform extension split
// keeps web/Android bundles clean — Metro picks the .ios.tsx variant
// on iOS, the .tsx variant on every other platform (returns null).
export function MobileToolbarAccessory({
    commands,
    toolbarState,
    editable,
}: MobileToolbarAccessoryProps) {
    const [keyboardOffset, setKeyboardOffset] = useState<number | null>(null)

    useEffect(() => {
        const showSub = Keyboard.addListener('keyboardWillShow', event => {
            setKeyboardOffset(event.endCoordinates.height)
        })
        const hideSub = Keyboard.addListener('keyboardWillHide', () => {
            setKeyboardOffset(null)
        })
        return () => {
            showSub.remove()
            hideSub.remove()
        }
    }, [])

    if (keyboardOffset == null) return null

    return (
        <View
            pointerEvents="box-none"
            style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: keyboardOffset,
            }}
        >
            <View className="flex-row items-center gap-2 px-3 py-2 border-t border-border bg-surface-secondary">
                <AccessoryButton
                    label="B"
                    bold
                    active={toolbarState.isBoldActive}
                    disabled={!editable}
                    onPress={() => commands.toggleBold()}
                />
                <AccessoryButton
                    label="I"
                    italic
                    active={toolbarState.isItalicActive}
                    disabled={!editable}
                    onPress={() => commands.toggleItalic()}
                />
                <AccessoryButton
                    label="U"
                    underline
                    active={toolbarState.isUnderlineActive}
                    disabled={!editable}
                    onPress={() => commands.toggleUnderline()}
                />
                <Separator />
                <AccessoryButton
                    label="H1"
                    active={toolbarState.activeHeadingLevel === 1}
                    disabled={!editable}
                    onPress={() => commands.toggleHeading(1)}
                />
                <AccessoryButton
                    label="H2"
                    active={toolbarState.activeHeadingLevel === 2}
                    disabled={!editable}
                    onPress={() => commands.toggleHeading(2)}
                />
                <Separator />
                <AccessoryButton
                    label="• List"
                    active={toolbarState.isBulletListActive}
                    disabled={!editable}
                    onPress={() => commands.toggleBulletList()}
                />
                <AccessoryButton
                    label="1. List"
                    active={toolbarState.isOrderedListActive}
                    disabled={!editable}
                    onPress={() => commands.toggleOrderedList()}
                />
                <AccessoryButton
                    label="❝"
                    active={toolbarState.isBlockquoteActive}
                    disabled={!editable}
                    onPress={() => commands.toggleBlockquote()}
                />
            </View>
        </View>
    )
}

interface AccessoryButtonProps {
    label: string
    onPress: () => void
    active?: boolean
    disabled?: boolean
    bold?: boolean
    italic?: boolean
    underline?: boolean
}

function AccessoryButton({
    label,
    onPress,
    active,
    disabled,
    bold,
    italic,
    underline,
}: AccessoryButtonProps) {
    const stateClass = active ? 'bg-accent' : 'bg-background'
    const opacityClass = disabled ? 'opacity-40' : ''
    return (
        <Pressable
            onPress={onPress}
            disabled={disabled}
            className={`rounded-md px-3 py-2 ${stateClass} ${opacityClass}`}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
        >
            <Text
                className="text-sm text-foreground"
                style={{
                    fontWeight: bold ? '700' : '400',
                    fontStyle: italic ? 'italic' : 'normal',
                    textDecorationLine: underline ? 'underline' : 'none',
                }}
            >
                {label}
            </Text>
        </Pressable>
    )
}

function Separator() {
    return <View className="w-px self-stretch bg-border mx-1" />
}
