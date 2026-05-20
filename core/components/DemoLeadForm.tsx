import { PB_SERVER_ADDR } from '@tinycld/core/lib/config'
import { captureException } from '@tinycld/core/lib/errors'
import {
    FormErrorSummary,
    TextAreaInput,
    TextInput,
    useForm,
    z,
    zodResolver,
} from '@tinycld/core/ui/form'
import { forwardRef, useImperativeHandle } from 'react'
import { View } from 'react-native'

export type DemoLeadSource = 'intro_modal' | 'banner_link'

export interface DemoLeadFormProps {
    source: DemoLeadSource
}

export interface DemoLeadFormHandle {
    /**
     * Validates the form and, on success, fires `POST /api/demo/lead` (no
     * await — the call site dismisses immediately). Returns `true` if the
     * submission was kicked off and `false` if validation failed (errors are
     * surfaced inline). Caller uses the return value to decide whether to
     * dismiss the surrounding modal.
     */
    submit: () => boolean
}

const schema = z.object({
    email: z.string().min(1, 'Email is required').email('Enter a valid email'),
    reason: z.string().max(2000).optional(),
})

type DemoLeadFormValues = z.infer<typeof schema>

export const DemoLeadForm = forwardRef<DemoLeadFormHandle, DemoLeadFormProps>(function DemoLeadForm(
    { source },
    ref
) {
    const {
        control,
        getValues,
        setError,
        clearErrors,
        formState: { errors, isSubmitted },
    } = useForm<DemoLeadFormValues>({
        resolver: zodResolver(schema),
        defaultValues: { email: '', reason: '' },
        mode: 'onChange',
    })

    useImperativeHandle(ref, () => ({
        submit: () => {
            // Validate synchronously via the schema so the surrounding
            // modal can decide whether to dismiss in the same tick.
            // react-hook-form's handleSubmit() returns a Promise even
            // for sync resolvers, so reading a closure flag right after
            // calling it always sees the initial value and the modal
            // never closes.
            const values = getValues()
            const result = schema.safeParse(values)
            if (!result.success) {
                clearErrors()
                for (const issue of result.error.issues) {
                    const fieldName = issue.path.join('.') as keyof DemoLeadFormValues
                    if (fieldName) {
                        setError(fieldName, { type: 'manual', message: issue.message })
                    }
                }
                return false
            }

            const body = JSON.stringify({
                email: result.data.email,
                reason: result.data.reason ?? '',
                source,
            })
            // Fire-and-forget. Network failures are logged but not
            // surfaced — the user has already left the form mentally.
            // Address PB explicitly via PB_SERVER_ADDR (matching
            // SetupPage / PackageManager) — the dev / native /
            // self-hosted topologies all run PB on a different origin
            // from the client, so a relative path would 404.
            fetch(`${PB_SERVER_ADDR}/api/demo/lead`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
            }).catch(err => {
                captureException('demo-lead-submit', err, { source })
            })
            return true
        },
    }))

    return (
        <View>
            <FormErrorSummary errors={errors} isEnabled={isSubmitted} />
            <TextInput
                control={control}
                name="email"
                label="Email"
                placeholder="you@example.com"
                autoCapitalize="none"
                keyboardType="email-address"
            />
            <TextAreaInput
                control={control}
                name="reason"
                label="What brings you here?"
                placeholder="Optional — share what you're hoping to do with TinyCld."
                numberOfLines={3}
            />
        </View>
    )
})
