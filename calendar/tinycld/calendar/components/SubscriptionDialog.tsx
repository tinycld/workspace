import { handleMutationErrorsWithForm } from '@tinycld/core/lib/errors'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgInfo } from '@tinycld/core/lib/use-org-info'
import { Button, ButtonText } from '@tinycld/core/ui/button'
import { FormErrorSummary, TextInput, useForm, z, zodResolver } from '@tinycld/core/ui/form'
import { Modal, ModalBackdrop, ModalContent } from '@tinycld/core/ui/modal'
import { newRecordId } from 'pbtsdb/core'
import { Pressable, Text, View } from 'react-native'
import { CALENDAR_COLOR_KEYS } from './calendar-colors'

const subscriptionSchema = z.object({
    url: z
        .string()
        .min(1, 'URL is required')
        .refine(
            (val) => val.startsWith('http://') || val.startsWith('https://') || val.startsWith('webcal://'),
            'Must be an HTTP(S) or webcal:// URL'
        ),
    name: z.string().min(1, 'Name is required'),
})

interface SubscriptionDialogProps {
    open: boolean
    onClose: () => void
}

export function SubscriptionDialog({ open, onClose }: SubscriptionDialogProps) {
    const { orgId } = useOrgInfo()
    const [calendarsCollection] = useStore('calendar_calendars')

    const {
        control,
        handleSubmit,
        setError,
        getValues,
        reset,
        formState: { errors, isSubmitted },
    } = useForm({
        mode: 'onChange',
        resolver: zodResolver(subscriptionSchema),
        defaultValues: {
            url: '',
            name: '',
        },
    })

    const createSubscription = useMutation({
        mutationFn: mutation(function* (data: z.infer<typeof subscriptionSchema>) {
            if (!orgId) throw new Error('No organization context')
            const randomColor = CALENDAR_COLOR_KEYS[Math.floor(Math.random() * CALENDAR_COLOR_KEYS.length)]
            yield calendarsCollection.insert({
                id: newRecordId(),
                org: orgId,
                name: data.name,
                description: '',
                color: randomColor,
                subscription_url: data.url,
                subscription_last_sync: '',
                subscription_error: '',
            })
        }),
        onSuccess: () => {
            reset()
            onClose()
        },
        onError: handleMutationErrorsWithForm({ setError, getValues }),
    })

    const onSubmit = handleSubmit((data) => createSubscription.mutate(data))

    const handleClose = () => {
        reset()
        onClose()
    }

    return (
        <Modal isOpen={open} onClose={handleClose}>
            <ModalBackdrop />
            <ModalContent className="w-[420px] p-0">
                <View className="px-5 pt-5 pb-3">
                    <Text className="text-foreground" style={{ fontSize: 16, fontWeight: '600' }}>
                        Subscribe to calendar
                    </Text>
                </View>

                <View className="px-5 pb-5 gap-3">
                    <FormErrorSummary errors={errors} isEnabled={isSubmitted} />

                    <TextInput
                        control={control}
                        name="url"
                        label="Calendar URL"
                        placeholder="https://example.com/calendar.ics"
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="url"
                    />

                    <TextInput control={control} name="name" label="Calendar name" placeholder="US Holidays" />

                    <View className="flex-row justify-end gap-2 pt-2">
                        <Pressable onPress={handleClose} className="px-3 py-1.5">
                            <Text className="text-foreground" style={{ fontSize: 14 }}>
                                Cancel
                            </Text>
                        </Pressable>
                        <Button onPress={onSubmit} isDisabled={createSubscription.isPending} size="sm">
                            <ButtonText>{createSubscription.isPending ? 'Subscribing...' : 'Subscribe'}</ButtonText>
                        </Button>
                    </View>
                </View>
            </ModalContent>
        </Modal>
    )
}
