import { eq } from '@tanstack/db'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { Plus, Tag, X } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { AddAliasForm } from './AddAliasForm'

interface Props {
    mailboxId: string
    mailboxDomainId: string
    domainName: string
}

export function MailboxAliasesPanel({ mailboxId, mailboxDomainId, domainName }: Props) {
    const primaryColor = useThemeColor('primary')
    const dangerColor = useThemeColor('danger')

    const [aliasesCollection] = useStore('mail_mailbox_aliases')
    const [showForm, setShowForm] = useState(false)

    const { data: aliases } = useOrgLiveQuery(
        (query) =>
            query
                .from({ mail_mailbox_aliases: aliasesCollection })
                .where(({ mail_mailbox_aliases }) => eq(mail_mailbox_aliases.mailbox, mailboxId)),
        [mailboxId]
    )

    const remove = useMutation({
        mutationFn: mutation(function* (aliasId: string) {
            yield aliasesCollection.delete(aliasId)
        }),
    })

    const items = aliases ?? []

    return (
        <View className="gap-3">
            <View className="flex-row items-center justify-between">
                <Text
                    className="text-muted-foreground"
                    style={{
                        fontSize: 11,
                        fontWeight: '600',
                        textTransform: 'uppercase',
                        letterSpacing: 0.6,
                    }}
                >
                    Aliases
                </Text>
                <Pressable onPress={() => setShowForm((s) => !s)} className="flex-row gap-1 items-center">
                    <Plus size={12} color={primaryColor} />
                    <Text className="text-primary" style={{ fontSize: 12, fontWeight: '600' }}>
                        {showForm ? 'Cancel' : 'Add alias'}
                    </Text>
                </Pressable>
            </View>

            {items.length === 0 && !showForm && (
                <Text className="text-muted-foreground" style={{ fontSize: 12.5 }}>
                    No aliases yet. Add one to route more addresses to this mailbox.
                </Text>
            )}

            {items.map((alias) => (
                <View key={alias.id} className="flex-row items-center gap-3 rounded-lg py-2">
                    <View
                        className="items-center justify-center rounded-lg"
                        style={{ width: 28, height: 28, backgroundColor: `${primaryColor}1F` }}
                    >
                        <Tag size={14} color={primaryColor} />
                    </View>
                    <Text className="flex-1 text-foreground" style={{ fontSize: 13 }}>
                        {alias.address}
                        <Text className="text-muted-foreground">@{domainName}</Text>
                    </Text>
                    <Pressable onPress={() => remove.mutate(alias.id)} className="p-1">
                        <X size={14} color={dangerColor} />
                    </Pressable>
                </View>
            ))}

            {showForm && (
                <AddAliasForm mailboxId={mailboxId} mailboxDomainId={mailboxDomainId} domainName={domainName} />
            )}
        </View>
    )
}
