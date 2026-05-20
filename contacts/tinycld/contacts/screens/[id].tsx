import { eq } from '@tanstack/db'
import { LabelBadge } from '@tinycld/core/components/LabelBadge'
import { StarIcon } from '@tinycld/core/components/StarIcon'
import { handleMutationErrorsWithForm } from '@tinycld/core/lib/errors'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useNavigateBack } from '@tinycld/core/lib/use-navigate-back'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { Button, ButtonText } from '@tinycld/core/ui/button'
import { useForm, zodResolver } from '@tinycld/core/ui/form'
import { useLabelMutations } from '@tinycld/core/ui/hooks/useLabelMutations'
import { useLabels, useLabelsForRecord } from '@tinycld/core/ui/hooks/useLabels'
import { useLocalSearchParams } from 'expo-router'
import { ArrowLeft } from 'lucide-react-native'
import { useMemo } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native'
import { ContactAvatar } from '../components/ContactAvatar'
import { ContactForm } from '../components/ContactForm'
import { contactSchema } from '../components/contactSchema'

export default function ContactDetailScreen() {
    const orgHref = useOrgHref()
    const navigateBack = useNavigateBack(() => orgHref('contacts'))
    const { id = '' } = useLocalSearchParams<{ id: string }>()
    const [contactsCollection] = useStore('contacts')
    const fgColor = useThemeColor('foreground')
    const mutedColor = useThemeColor('muted-foreground')

    const { labels: orgLabels } = useLabels()
    const recordLabels = useLabelsForRecord(id, 'contacts')
    const { assignLabel, unassignLabel } = useLabelMutations()

    const assignedLabelIds = useMemo(
        () => new Set(recordLabels.labels.map(l => l.id)),
        [recordLabels.labels]
    )

    const { data } = useOrgLiveQuery(
        query =>
            query
                .from({ contacts: contactsCollection })
                .where(({ contacts }) => eq(contacts.id, id)),
        [id]
    )

    const contact = data?.[0] ?? null

    const {
        control,
        handleSubmit,
        setError,
        getValues,
        formState: { errors, isSubmitted },
    } = useForm({
        mode: 'onChange',
        resolver: zodResolver(contactSchema),
        values: contact
            ? {
                  first_name: contact.first_name ?? '',
                  last_name: contact.last_name ?? '',
                  email: contact.email ?? '',
                  phone: contact.phone ?? '',
                  company: contact.company ?? '',
                  job_title: contact.job_title ?? '',
                  notes: contact.notes ?? '',
                  favorite: contact.favorite ?? false,
              }
            : undefined,
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

    const updateContact = useMutation({
        mutationFn: mutation(function* (formData: {
            first_name: string
            last_name: string
            email: string
            phone: string
            company: string
            job_title: string
            notes: string
            favorite: boolean
        }) {
            yield contactsCollection.update(id, draft => {
                draft.first_name = formData.first_name.trim()
                draft.last_name = formData.last_name.trim()
                draft.email = formData.email
                draft.phone = formData.phone
                draft.company = formData.company.trim()
                draft.job_title = formData.job_title.trim()
                draft.notes = formData.notes
                draft.favorite = formData.favorite
            })
        }),
        onError: handleMutationErrorsWithForm({ setError, getValues }),
    })

    const toggleFavorite = useMutation({
        mutationFn: mutation(function* () {
            if (!contact) return
            yield contactsCollection.update(id, draft => {
                draft.favorite = !contact.favorite
            })
        }),
    })

    const onSubmit = handleSubmit(formData => updateContact.mutate(formData))

    const handleToggleLabel = (labelId: string) => {
        if (assignedLabelIds.has(labelId)) {
            unassignLabel.mutate({ labelId, recordId: id, collection: 'contacts' })
        } else {
            assignLabel.mutate({ labelId, recordId: id, collection: 'contacts' })
        }
    }

    if (!contact) {
        return (
            <View className="flex-1 p-5 bg-background">
                <Text className="text-base text-muted-foreground">Contact not found</Text>
            </View>
        )
    }

    const displayName = [contact.first_name, contact.last_name].filter(Boolean).join(' ')

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            className="flex-1 bg-background"
        >
            <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
                <View className="flex-1 p-5">
                    <View className="flex-row justify-between items-center mb-5">
                        <Pressable onPress={navigateBack}>
                            <ArrowLeft size={24} color={fgColor} />
                        </Pressable>
                        <View className="flex-row gap-3 items-center">
                            <Pressable onPress={() => toggleFavorite.mutate()}>
                                <StarIcon isStarred={contact.favorite} size={24} />
                            </Pressable>
                            <Button
                                onPress={onSubmit}
                                isDisabled={updateContact.isPending}
                                size="sm"
                            >
                                <ButtonText>
                                    {updateContact.isPending ? 'Saving...' : 'Save'}
                                </ButtonText>
                            </Button>
                        </View>
                    </View>

                    <View className="items-center mb-5 gap-2">
                        <ContactAvatar
                            firstName={contact.first_name}
                            lastName={contact.last_name}
                            size={80}
                        />
                        <Text className="text-2xl font-bold text-foreground">{displayName}</Text>
                        {contact.email ? (
                            <Text className="text-sm text-muted-foreground">{contact.email}</Text>
                        ) : null}
                    </View>

                    {orgLabels.length > 0 ? (
                        <View className="mb-5 gap-2">
                            <Text className="text-sm font-semibold text-muted-foreground">
                                Labels
                            </Text>
                            <View className="flex-row flex-wrap gap-2">
                                {orgLabels.map(label => {
                                    const assigned = assignedLabelIds.has(label.id)
                                    return (
                                        <Pressable
                                            key={label.id}
                                            onPress={() => handleToggleLabel(label.id)}
                                        >
                                            <LabelBadge
                                                name={label.name}
                                                color={assigned ? label.color : mutedColor}
                                            />
                                        </Pressable>
                                    )
                                })}
                            </View>
                        </View>
                    ) : null}

                    <ContactForm control={control} errors={errors} isSubmitted={isSubmitted} />
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    )
}
