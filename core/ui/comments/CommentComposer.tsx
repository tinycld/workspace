import { FormErrorSummary, TextAreaInput, useForm, z, zodResolver } from '@tinycld/core/ui/form'
import { useCallback } from 'react'
import { Pressable, Text, View } from 'react-native'
import { MentionInput, type MentionSuggestion } from './MentionInput'

const composerSchema = z.object({
    body: z.string().trim().min(1, 'Required').max(4000),
})

type ComposerValues = z.infer<typeof composerSchema>

export interface CommentComposerProps {
    placeholder?: string
    submitLabel: string
    isPending?: boolean
    error?: string | null
    autoFocus?: boolean
    onCancel?: () => void
    onSubmit: (body: string) => void
    // When supplied, the composer renders a MentionInput instead of a
    // plain TextAreaInput. The body still flows through the same form
    // value, so onSubmit's signature is unchanged — the only thing
    // that changes is that `[[@id]]` tokens may be embedded in the
    // submitted string.
    mentionSuggestions?: MentionSuggestion[]
}

// Form composer used inside the drawer (new thread / reply) and any
// other comments surface in the future. Owns its own form state; the
// caller passes raw onSubmit(body) and gets isPending/error feedback in.
// Mentions activate when the caller supplies `mentionSuggestions`.
export function CommentComposer(props: CommentComposerProps) {
    const {
        control,
        handleSubmit,
        reset,
        formState: { errors, isSubmitted },
    } = useForm<ComposerValues>({
        resolver: zodResolver(composerSchema),
        defaultValues: { body: '' },
        mode: 'onChange',
    })

    const onSubmit = useCallback(
        () =>
            handleSubmit(values => {
                props.onSubmit(values.body)
                reset({ body: '' })
            })(),
        [handleSubmit, props.onSubmit, reset]
    )

    const useMentions = props.mentionSuggestions !== undefined

    return (
        <View>
            <FormErrorSummary errors={errors} isEnabled={isSubmitted} />
            {props.error ? <Text className="text-xs text-danger mb-2">{props.error}</Text> : null}
            {useMentions ? (
                <MentionInput
                    control={control}
                    name="body"
                    placeholder={props.placeholder}
                    autoFocus={props.autoFocus}
                    numberOfLines={3}
                    suggestions={props.mentionSuggestions ?? []}
                />
            ) : (
                <TextAreaInput
                    control={control}
                    name="body"
                    placeholder={props.placeholder}
                    autoFocus={props.autoFocus}
                    numberOfLines={3}
                />
            )}
            <View className="flex-row justify-end gap-2 mt-2">
                {props.onCancel ? (
                    <Pressable
                        accessibilityRole="button"
                        onPress={props.onCancel}
                        accessibilityLabel="Cancel comment"
                        className="px-3 py-1.5 rounded-md"
                    >
                        <Text className="text-xs font-semibold text-muted-foreground">Cancel</Text>
                    </Pressable>
                ) : null}
                <Pressable
                    accessibilityRole="button"
                    onPress={onSubmit}
                    accessibilityLabel={props.submitLabel}
                    className="px-3 py-1.5 rounded-md bg-primary"
                    disabled={props.isPending}
                    style={{ opacity: props.isPending ? 0.6 : 1 }}
                >
                    <Text className="text-xs font-semibold text-primary-foreground">
                        {props.submitLabel}
                    </Text>
                </Pressable>
            </View>
        </View>
    )
}
