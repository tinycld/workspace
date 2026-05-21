import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useRef, useState } from 'react'
import {
    type NativeSyntheticEvent,
    Pressable,
    Text,
    TextInput,
    type TextInputKeyPressEventData,
    View,
} from 'react-native'
import { useRenameDocument } from '../hooks/use-rename-document'
import {
    EMPTY_NAME_ERROR,
    RENAME_FAILED_ERROR,
    resolveCommit,
} from './document-title-edit'

interface DocumentTitleProps {
    documentId: string
    name: string
    isReadOnly: boolean
}

// Inline document-title editor. The static <Text> swaps to a focused
// <TextInput> when the user clicks the title (single click — double
// click adds nothing here and on iOS/Android there is no double-tap
// affordance for a title; single-click matches Drive's pattern).
//
// Edit-mode is genuine transient local UI state — no other component
// cares whether the title is in edit mode — so useState is the right
// primitive here. The rename mutation lives in useRenameDocument so
// the title can show its pending/error state without re-implementing
// the pbtsdb call.
export function DocumentTitle({ documentId, name, isReadOnly }: DocumentTitleProps) {
    const { rename, isPending, error, reset } = useRenameDocument(documentId)
    const [isEditing, setIsEditing] = useState(false)
    const [draft, setDraft] = useState(name)
    const [inlineError, setInlineError] = useState<string | null>(null)
    const inputRef = useRef<TextInput>(null)
    // Escape unmounts the input synchronously, which triggers RN-web's
    // onBlur on the same focused element a tick later. Without this
    // guard the blur path would call handleCommit against the original
    // draft (Escape didn't clear it), turning Escape into a noop only
    // by accident. Set the flag before unmounting and the deferred
    // blur becomes a real no-op.
    const cancelledRef = useRef(false)
    const fg = useThemeColor('foreground')

    const enterEditMode = () => {
        if (isReadOnly || isPending) return
        setDraft(name)
        setInlineError(null)
        cancelledRef.current = false
        reset()
        setIsEditing(true)
    }

    const exitWithoutSubmitting = () => {
        cancelledRef.current = true
        setIsEditing(false)
        setInlineError(null)
    }

    const handleCommit = () => {
        if (cancelledRef.current) {
            cancelledRef.current = false
            return
        }
        const outcome = resolveCommit(draft, name)
        if (outcome.type === 'noop') {
            if (outcome.reason === 'empty') {
                setInlineError(EMPTY_NAME_ERROR)
                // Hand focus back so the user can correct the value
                // rather than silently bouncing them to the static
                // title with an unexplained revert.
                inputRef.current?.focus()
                return
            }
            exitWithoutSubmitting()
            return
        }
        rename(outcome.trimmedName)
        setIsEditing(false)
        setInlineError(null)
    }

    const handleKeyPress = (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
        if (e.nativeEvent.key === 'Escape') {
            exitWithoutSubmitting()
        }
    }

    if (isEditing) {
        return (
            <View className="flex-1">
                <TextInput
                    ref={inputRef}
                    value={draft}
                    onChangeText={setDraft}
                    autoFocus
                    selectTextOnFocus
                    onBlur={handleCommit}
                    onSubmitEditing={handleCommit}
                    onKeyPress={handleKeyPress}
                    returnKeyType="done"
                    blurOnSubmit
                    accessibilityLabel="Document name"
                    className="text-base font-semibold rounded-md border border-border bg-field-background px-2 py-1"
                    style={{ color: fg }}
                />
                {inlineError != null ? (
                    <Text className="text-xs text-danger mt-1">{inlineError}</Text>
                ) : null}
            </View>
        )
    }

    return (
        <View className="flex-1">
            <Pressable
                accessibilityRole={isReadOnly ? 'text' : 'button'}
                accessibilityLabel={isReadOnly ? name : `Rename document, currently ${name}`}
                disabled={isReadOnly || isPending}
                onPress={enterEditMode}
            >
                <Text
                    className={`text-base font-semibold text-foreground ${isPending ? 'opacity-50' : ''}`}
                    numberOfLines={1}
                >
                    {name}
                </Text>
            </Pressable>
            {error != null ? (
                <Text className="text-xs text-danger mt-1">{RENAME_FAILED_ERROR}</Text>
            ) : null}
        </View>
    )
}
