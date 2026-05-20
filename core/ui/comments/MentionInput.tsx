import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useCallback, useMemo, useRef, useState } from 'react'
import { type Control, type FieldValues, type Path, useController } from 'react-hook-form'
import type { TextInputProps as RNTextInputProps } from 'react-native'
import {
    type NativeSyntheticEvent,
    Pressable,
    TextInput as RNTextInput,
    Text,
    type TextInputSelectionChangeEventData,
    View,
} from 'react-native'
import { detectTrigger } from './mention-input-helpers'

// A composer textarea that autocompletes @-mentions. The control is
// react-hook-form-aware (matches TextAreaInput's shape) so it slots
// straight into CommentComposer / NewCommentButton without a parallel
// form pipeline.
//
// Wire format: when the user picks a suggestion, the bare `@query`
// they typed is replaced with the literal token `[[@<userOrgId>]]`
// followed by a space. The token is what gets stored in the comment
// body — `parseMentions` (lib/comments/mentions.ts) extracts it later
// for the comment_mentions rows. Read-mode rendering is the consumer's
// concern (they have access to the user_org → display name map).
//
// Why not parse the token in this component: rendering tokens as
// pretty pills inside a controlled <TextInput> means re-implementing
// caret positioning + cursor jumps across mark boundaries on every
// platform. v1 ships the raw token visible in the input; we trade
// a bit of in-input ugliness for a control flow that's actually
// readable and doesn't break the form value contract.

export interface MentionSuggestion {
    userOrgId: string
    displayName: string
    // Optional secondary line — caller often wants to surface an
    // email or role here. Falsy values are ignored.
    secondary?: string
}

export type MentionInputProps<T extends FieldValues = Record<string, unknown>> = Omit<
    RNTextInputProps,
    'value' | 'onChangeText' | 'onBlur' | 'onSelectionChange'
> & {
    name: Path<T>
    control: Control<T>
    // Caller supplies the full pool of candidates (typically the
    // org's user_org rows joined with users). We filter client-side
    // against the active @-query — pools are small enough (tens, not
    // thousands) that a remote search isn't worth the round trip.
    suggestions: MentionSuggestion[]
    numberOfLines?: number
    // Max suggestion rows shown in the popover. Default 6.
    maxSuggestions?: number
}

export function MentionInput<T extends FieldValues = Record<string, unknown>>(
    props: MentionInputProps<T>
) {
    const {
        name,
        control,
        suggestions,
        numberOfLines = 3,
        maxSuggestions = 6,
        ...inputProps
    } = props

    const {
        field,
        fieldState: { error },
    } = useController({ name, control })

    const placeholderColor = useThemeColor('field-placeholder')
    const inputRef = useRef<RNTextInput | null>(null)

    const [selection, setSelection] = useState<{ start: number; end: number }>({
        start: 0,
        end: 0,
    })

    const value: string = field.value || ''

    const trigger = useMemo(() => detectTrigger(value, selection.start), [value, selection.start])

    const filteredSuggestions = useMemo(() => {
        if (!trigger) return []
        const q = trigger.query.toLowerCase()
        if (!q) return suggestions.slice(0, maxSuggestions)
        return suggestions
            .filter(s => s.displayName.toLowerCase().includes(q))
            .slice(0, maxSuggestions)
    }, [suggestions, trigger, maxSuggestions])

    const onChangeText = useCallback(
        (next: string) => {
            field.onChange(next)
        },
        [field]
    )

    const onSelectionChange = useCallback(
        (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
            setSelection(e.nativeEvent.selection)
        },
        []
    )

    const onPick = useCallback(
        (s: MentionSuggestion) => {
            if (!trigger) return
            const before = value.slice(0, trigger.atIndex)
            const after = value.slice(trigger.caretIndex)
            const token = `[[@${s.userOrgId}]] `
            const next = `${before}${token}${after}`
            field.onChange(next)
            // Re-focus + collapse caret just after the inserted token
            // so subsequent typing happens in the right spot.
            const nextCaret = before.length + token.length
            setSelection({ start: nextCaret, end: nextCaret })
            // RN TextInput doesn't honor a programmatic `selection`
            // prop while the user holds focus on some platforms; the
            // imperative ref call covers iOS/Android. Web's react-
            // native-web maps both to the underlying <textarea>.
            inputRef.current?.setNativeProps?.({
                selection: { start: nextCaret, end: nextCaret },
            })
        },
        [trigger, value, field]
    )

    const hasError = !!error
    const showSuggestions = !!trigger && filteredSuggestions.length > 0

    return (
        <View>
            <RNTextInput
                ref={inputRef}
                multiline
                numberOfLines={numberOfLines}
                value={value}
                onChangeText={onChangeText}
                onBlur={field.onBlur}
                onSelectionChange={onSelectionChange}
                accessibilityLabel={name}
                testID={name}
                placeholder={inputProps.placeholder}
                placeholderTextColor={placeholderColor}
                textAlignVertical="top"
                className={`border rounded-lg px-3 py-2.5 text-base text-foreground bg-background ${
                    hasError ? 'border-danger' : 'border-border'
                }`}
                style={{ minHeight: numberOfLines * 24 }}
                {...inputProps}
            />
            {showSuggestions ? (
                <View className="mt-1 border border-border rounded-md bg-background overflow-hidden">
                    {filteredSuggestions.map(s => (
                        <Pressable
                            key={s.userOrgId}
                            onPress={() => onPick(s)}
                            accessibilityLabel={`Mention ${s.displayName}`}
                            className="px-3 py-2 border-b border-border"
                        >
                            <Text className="text-sm text-foreground">{s.displayName}</Text>
                            {s.secondary ? (
                                <Text className="text-xs text-muted-foreground">{s.secondary}</Text>
                            ) : null}
                        </Pressable>
                    ))}
                </View>
            ) : null}
            {hasError ? <Text className="text-xs text-danger mt-1">{error.message}</Text> : null}
        </View>
    )
}
