import { HelpIcon } from '@tinycld/core/components/help/HelpIcon'
import { handleMutationErrorsWithForm } from '@tinycld/core/lib/errors'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useCurrentUserOrg } from '@tinycld/core/lib/use-current-user-org'
import { useNavigateBack } from '@tinycld/core/lib/use-navigate-back'
import { useOrgInfo } from '@tinycld/core/lib/use-org-info'
import { Button, ButtonText } from '@tinycld/core/ui/button'
import { useForm, type z, zodResolver } from '@tinycld/core/ui/form'
import { ArrowLeft } from 'lucide-react-native'
import { newRecordId } from 'pbtsdb/core'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native'
import { ContactForm } from '../components/ContactForm'
import { contactSchema } from '../components/contactSchema'

export default function NewContactScreen() {
    const { orgSlug } = useOrgInfo()
    const userOrg = useCurrentUserOrg(orgSlug)
    const [contactsCollection] = useStore('contacts')
    const fgColor = useThemeColor('foreground')
    const orgHref = useOrgHref()
    const navigateBack = useNavigateBack(() => orgHref('contacts'))

    const {
        control,
        handleSubmit,
        setError,
        getValues,
        formState: { errors, isSubmitted },
    } = useForm({
        mode: 'onChange',
        resolver: zodResolver(contactSchema),
        defaultValues: {
            first_name: '',
            last_name: '',
            email: '',
            phone: '',
            company: '',
            job_title: '',
            notes: '',
            favorite: false,
        },
    })

    const createContact = useMutation({
        mutationFn: mutation(function* (data: z.infer<typeof contactSchema>) {
            if (!userOrg) throw new Error('No organization context')
            yield contactsCollection.insert({
                id: newRecordId(),
                first_name: data.first_name.trim(),
                last_name: data.last_name.trim(),
                email: data.email,
                phone: data.phone,
                company: data.company.trim(),
                job_title: data.job_title.trim(),
                notes: data.notes,
                favorite: data.favorite,
                owner: userOrg.id,
                vcard_uid: crypto.randomUUID(),
            })
        }),
        onSuccess: navigateBack,
        onError: handleMutationErrorsWithForm({ setError, getValues }),
    })

    const onSubmit = handleSubmit(data => createContact.mutate(data))
    const canSubmit = !createContact.isPending && !!userOrg

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            className="flex-1 bg-background"
        >
            <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
                <View className="flex-1 p-5">
                    <View className="flex-row justify-between items-center mb-5">
                        <View className="flex-row gap-3 items-center">
                            <Pressable onPress={navigateBack}>
                                <ArrowLeft size={24} color={fgColor} />
                            </Pressable>
                            <Text className="text-2xl font-bold text-foreground">
                                Create Contact
                            </Text>
                            <HelpIcon topic="contacts:adding-contacts" size={18} />
                        </View>
                        <Button onPress={onSubmit} isDisabled={!canSubmit} size="sm">
                            <ButtonText>
                                {createContact.isPending ? 'Creating...' : 'Create'}
                            </ButtonText>
                        </Button>
                    </View>

                    <ContactForm control={control} errors={errors} isSubmitted={isSubmitted} />
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    )
}
