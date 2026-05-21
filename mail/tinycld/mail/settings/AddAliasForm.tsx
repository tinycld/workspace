import { eq } from '@tanstack/db'
import { handleMutationErrorsWithForm } from '@tinycld/core/lib/errors'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { FormErrorSummary, TextInput, useForm, z, zodResolver } from '@tinycld/core/ui/form'
import { Plus } from 'lucide-react-native'
import { newRecordId } from 'pbtsdb/core'
import { Pressable, Text, View } from 'react-native'

const schema = z.object({
    address: z
        .string()
        .min(1, 'Address is required')
        .max(64)
        .regex(/^[a-z0-9._-]+$/, 'Only lowercase letters, numbers, dots, hyphens, underscores'),
})

interface Props {
    mailboxId: string
    mailboxDomainId: string
    domainName: string
}

export function AddAliasForm({ mailboxId, mailboxDomainId, domainName }: Props) {
    const primaryColor = useThemeColor('primary')
    const primaryFgColor = useThemeColor('primary-foreground')

    const [aliasesCollection, mailboxesCollection] = useStore('mail_mailbox_aliases', 'mail_mailboxes')

    const { data: mailboxesInDomain } = useOrgLiveQuery(
        (query) =>
            query
                .from({ mail_mailboxes: mailboxesCollection })
                .where(({ mail_mailboxes }) => eq(mail_mailboxes.domain, mailboxDomainId)),
        [mailboxDomainId]
    )
    const { data: aliasesAll } = useOrgLiveQuery((query) => query.from({ mail_mailbox_aliases: aliasesCollection }))

    const {
        control,
        handleSubmit,
        reset,
        setError,
        getValues,
        formState: { errors, isSubmitted, isDirty },
    } = useForm({
        mode: 'onChange',
        resolver: zodResolver(schema),
        defaultValues: { address: '' },
    })

    const create = useMutation({
        mutationFn: mutation(function* (data: z.infer<typeof schema>) {
            const addr = data.address.toLowerCase().trim()

            const primaryCollision = (mailboxesInDomain ?? []).some((m) => m.address === addr)
            if (primaryCollision) {
                throw new Error('Address is already a primary mailbox on this domain')
            }
            const mailboxIdsInDomain = new Set((mailboxesInDomain ?? []).map((m) => m.id))
            const aliasCollision = (aliasesAll ?? []).some(
                (a) => mailboxIdsInDomain.has(a.mailbox) && a.address === addr
            )
            if (aliasCollision) {
                throw new Error('Address is already an alias on this domain')
            }

            yield aliasesCollection.insert({
                id: newRecordId(),
                mailbox: mailboxId,
                address: addr,
                created: '',
                updated: '',
            })
        }),
        onSuccess: () => reset(),
        onError: handleMutationErrorsWithForm({ setError, getValues }),
    })

    const onSubmit = handleSubmit((d) => create.mutate(d))
    const canSubmit = !create.isPending && isDirty

    return (
        <View className="gap-2">
            <FormErrorSummary errors={errors} isEnabled={isSubmitted} />
            <View
                className="flex-row gap-2 items-center rounded-lg px-2 border border-border"
                style={{ borderStyle: 'dashed' }}
            >
                <View className="flex-1">
                    <TextInput control={control} name="address" placeholder="new-alias" />
                </View>
                <Text className="text-muted-foreground" style={{ fontSize: 13 }}>
                    @{domainName}
                </Text>
                <Pressable
                    onPress={onSubmit}
                    disabled={!canSubmit}
                    className="rounded-md"
                    style={{
                        paddingVertical: 6,
                        paddingHorizontal: 10,
                        backgroundColor: primaryColor,
                        opacity: canSubmit ? 1 : 0.5,
                    }}
                >
                    <View className="flex-row gap-1 items-center">
                        <Plus size={12} color={primaryFgColor} />
                        <Text style={{ color: primaryFgColor, fontSize: 12, fontWeight: '600' }}>Add</Text>
                    </View>
                </Pressable>
            </View>
        </View>
    )
}
