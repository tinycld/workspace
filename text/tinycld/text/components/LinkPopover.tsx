import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useState } from 'react'
import { Modal, Platform, Pressable, Text, TextInput, View } from 'react-native'
import { linkPopoverContentsKey } from './link-popover-key'

interface LinkPopoverProps {
    isOpen: boolean
    initialUrl: string
    onCancel: () => void
    onInsert: (url: string) => void
}

// Minimal link insert/edit UI. Renders as a centred Modal — popover
// positioning over a toolbar button is platform-dependent and not
// worth wiring up in v1; the modal is unambiguous and works on every
// platform. An empty URL on submit signals "remove link" to the
// caller (which calls removeLink() instead of setLink('')).
//
// The form state (the URL the user is typing) lives in a child
// LinkPopoverContents component keyed on `${isOpen}-${initialUrl}`.
// React unmounts and remounts the child whenever either key segment
// flips, which re-seeds the input from `initialUrl` without needing a
// useState+useEffect sync — opening on a fresh link, or re-opening
// after a cancel, both produce a clean form with the correct seed.
export function LinkPopover({ isOpen, initialUrl, onCancel, onInsert }: LinkPopoverProps) {
    if (!isOpen) return null

    return (
        <Modal transparent animationType="fade" visible={isOpen} onRequestClose={onCancel}>
            <Pressable
                className="flex-1 items-center justify-center bg-black/30"
                onPress={onCancel}
            >
                <LinkPopoverContents
                    key={linkPopoverContentsKey(isOpen, initialUrl)}
                    initialUrl={initialUrl}
                    onCancel={onCancel}
                    onInsert={onInsert}
                />
            </Pressable>
        </Modal>
    )
}

interface LinkPopoverContentsProps {
    initialUrl: string
    onCancel: () => void
    onInsert: (url: string) => void
}

// The form body. The parent remounts this on each open transition (or
// when initialUrl changes mid-session), so a plain useState initialiser
// is sufficient — no effect needed to re-seed.
function LinkPopoverContents({ initialUrl, onCancel, onInsert }: LinkPopoverContentsProps) {
    const [url, setUrl] = useState(initialUrl)
    const fg = useThemeColor('foreground')
    const placeholderColor = useThemeColor('field-placeholder')

    return (
        <Pressable className="w-[320px] gap-3 p-4 rounded-lg bg-background border border-border">
            <Text className="text-sm font-semibold text-foreground">Insert link</Text>
            <TextInput
                autoFocus
                value={url}
                onChangeText={setUrl}
                placeholder="https://example.com"
                placeholderTextColor={placeholderColor}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                className="px-2 py-1.5 rounded-md border border-border bg-field-background"
                style={{ color: fg }}
            />
            <View className="flex-row justify-end gap-2">
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Cancel"
                    onPress={onCancel}
                    className="px-3 py-1.5 rounded-md bg-surface-secondary"
                    hitSlop={
                        Platform.OS === 'web'
                            ? undefined
                            : { top: 6, bottom: 6, left: 4, right: 4 }
                    }
                >
                    <Text className="text-sm text-foreground">Cancel</Text>
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Insert link"
                    onPress={() => onInsert(url.trim())}
                    className="px-3 py-1.5 rounded-md bg-accent"
                    hitSlop={
                        Platform.OS === 'web'
                            ? undefined
                            : { top: 6, bottom: 6, left: 4, right: 4 }
                    }
                >
                    <Text className="text-sm font-medium text-accent-foreground">Insert</Text>
                </Pressable>
            </View>
        </Pressable>
    )
}
