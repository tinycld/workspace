import { handleMutationErrorsWithForm } from '@tinycld/core/lib/errors'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { FormErrorSummary, SelectInput, TextInput, useForm, z, zodResolver } from '@tinycld/core/ui/form'
import { Plus } from 'lucide-react-native'
import { newRecordId } from 'pbtsdb/core'
import { Pressable, Text, View } from 'react-native'

const mailboxSchema = z.object({
    address: z
        .string()
        .min(1, 'Address is required')
        .max(64)
        .regex(/^[a-z0-9._-]+$/, 'Only lowercase letters, numbers, dots, hyphens, underscores'),
    domain: z.string().min(1, 'Domain is required'),
    display_name: z.string().min(1, 'Display name is required').max(200),
})

export type MailboxFormValues = z.infer<typeof mailboxSchema>

interface CreateProps {
    mode: 'create'
    domainOptions: Array<{ label: string; value: string }>
    userOrgId: string
    onDone: () => void
}

interface EditProps {
    mode: 'edit'
    mailboxId: string
    initial: MailboxFormValues
    domainName: string
    onDone: () => void
}

type Props = CreateProps | EditProps

export function MailboxForm(props: Props) {
    return props.mode === 'create' ? <CreateForm {...props} /> : <EditForm {...props} />
}

function CreateForm({ domainOptions, userOrgId, onDone }: CreateProps) {
    const primaryColor = useThemeColor('primary')
    const primaryFgColor = useThemeColor('primary-foreground')
    const [mailboxesCollection, membersCollection] = useStore('mail_mailboxes', 'mail_mailbox_members')

    const {
        control,
        handleSubmit,
        setError,
        getValues,
        watch,
        reset,
        formState: { errors, isSubmitted, isDirty, isValid },
    } = useForm<MailboxFormValues>({
        mode: 'onChange',
        resolver: zodResolver(mailboxSchema),
        defaultValues: {
            address: '',
            domain: domainOptions[0]?.value ?? '',
            display_name: '',
        },
    })

    const createMutation = useMutation({
        mutationFn: mutation(function* (data: MailboxFormValues) {
            const mailboxId = newRecordId()
            yield mailboxesCollection.insert({
                id: mailboxId,
                address: data.address,
                domain: data.domain,
                display_name: data.display_name,
                name: data.display_name,
                type: 'shared',
            })
            yield membersCollection.insert({
                id: newRecordId(),
                mailbox: mailboxId,
                user_org: userOrgId,
                role: 'owner',
            })
        }),
        onSuccess: () => {
            reset()
            onDone()
        },
        onError: handleMutationErrorsWithForm({ setError, getValues }),
    })

    const onSubmit = handleSubmit((d) => createMutation.mutate(d))
    const canSubmit = !createMutation.isPending && isDirty && isValid
    const values = watch()
    const domainName = domainOptions.find((d) => d.value === values.domain)?.label ?? ''

    return (
        <FormLayout
            errors={errors}
            isSubmitted={isSubmitted}
            control={control}
            domainOptions={domainOptions}
            preview={{
                address: values.address,
                domainName,
                displayName: values.display_name,
            }}
            submitLabel={createMutation.isPending ? 'Creating…' : 'Create mailbox'}
            canSubmit={canSubmit}
            onSubmit={onSubmit}
            primaryColor={primaryColor}
            primaryFgColor={primaryFgColor}
        />
    )
}

function EditForm({ mailboxId, initial, domainName, onDone }: EditProps) {
    const primaryColor = useThemeColor('primary')
    const primaryFgColor = useThemeColor('primary-foreground')
    const [mailboxesCollection] = useStore('mail_mailboxes')

    const {
        control,
        handleSubmit,
        setError,
        getValues,
        watch,
        formState: { errors, isSubmitted, isDirty, isValid },
    } = useForm<MailboxFormValues>({
        mode: 'onChange',
        resolver: zodResolver(mailboxSchema),
        defaultValues: initial,
    })

    const editMutation = useMutation({
        mutationFn: mutation(function* (data: MailboxFormValues) {
            yield mailboxesCollection.update(mailboxId, (draft) => {
                draft.address = data.address
                draft.display_name = data.display_name
                draft.name = data.display_name
            })
        }),
        onSuccess: onDone,
        onError: handleMutationErrorsWithForm({ setError, getValues }),
    })

    const onSubmit = handleSubmit((d) => editMutation.mutate(d))
    const canSubmit = !editMutation.isPending && isDirty && isValid
    const values = watch()

    return (
        <FormLayout
            errors={errors}
            isSubmitted={isSubmitted}
            control={control}
            domainOptions={[{ label: domainName, value: initial.domain }]}
            domainDisabled
            preview={{
                address: values.address,
                domainName,
                displayName: values.display_name,
            }}
            submitLabel={editMutation.isPending ? 'Saving…' : 'Save changes'}
            canSubmit={canSubmit}
            onSubmit={onSubmit}
            primaryColor={primaryColor}
            primaryFgColor={primaryFgColor}
        />
    )
}

interface FormLayoutProps {
    errors: Parameters<typeof FormErrorSummary>[0]['errors']
    isSubmitted: boolean
    control: ReturnType<typeof useForm<MailboxFormValues>>['control']
    domainOptions: Array<{ label: string; value: string }>
    domainDisabled?: boolean
    preview: { address: string; domainName: string; displayName: string }
    submitLabel: string
    canSubmit: boolean
    onSubmit: () => void
    primaryColor: string
    primaryFgColor: string
}

function FormLayout({
    errors,
    isSubmitted,
    control,
    domainOptions,
    domainDisabled,
    preview,
    submitLabel,
    canSubmit,
    onSubmit,
    primaryColor,
    primaryFgColor,
}: FormLayoutProps) {
    const previewInitial = (preview.displayName || preview.address || '?').trim().charAt(0).toUpperCase()

    return (
        <View className="gap-4">
            <FormErrorSummary errors={errors} isEnabled={isSubmitted} />
            <TextInput
                control={control}
                name="address"
                label="Address"
                placeholder="support"
                hint={`will be: ${preview.address || '…'}@${preview.domainName || '…'}`}
            />
            {domainOptions.length > 1 && !domainDisabled ? (
                <SelectInput control={control} name="domain" label="Domain" options={domainOptions} />
            ) : null}
            <TextInput
                control={control}
                name="display_name"
                label="Display name"
                placeholder="Support Team"
                hint="shown in the From: header and in the admin list"
            />
            <View className="flex-row gap-3 items-center rounded-lg p-3 border border-border">
                <View
                    className="items-center justify-center rounded-lg bg-primary/10"
                    style={{ width: 30, height: 30 }}
                >
                    <Text className="text-primary" style={{ fontWeight: '700', fontSize: 13 }}>
                        {previewInitial}
                    </Text>
                </View>
                <View className="flex-1" style={{ minWidth: 0 }}>
                    <Text className="text-foreground" style={{ fontSize: 13, fontWeight: '600' }}>
                        {preview.address || '…'}
                        <Text className="text-muted-foreground" style={{ fontWeight: '500' }}>
                            @{preview.domainName || '…'}
                        </Text>
                    </Text>
                    <Text className="text-muted-foreground" style={{ fontSize: 11.5 }}>
                        {preview.displayName || 'Display name'}
                    </Text>
                </View>
                <Text
                    className="text-muted-foreground"
                    style={{
                        fontSize: 10,
                        textTransform: 'uppercase',
                        fontWeight: '600',
                        letterSpacing: 0.6,
                    }}
                >
                    Preview
                </Text>
            </View>
            <Pressable
                onPress={onSubmit}
                disabled={!canSubmit}
                className="flex-row items-center justify-center gap-2 rounded-lg h-11"
                style={{ backgroundColor: primaryColor, opacity: canSubmit ? 1 : 0.5 }}
            >
                <Plus size={16} color={primaryFgColor} />
                <Text style={{ fontWeight: '600', color: primaryFgColor }}>{submitLabel}</Text>
            </Pressable>
        </View>
    )
}
