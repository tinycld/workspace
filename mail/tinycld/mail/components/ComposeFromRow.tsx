import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useEffect } from 'react'
import { Text, View } from 'react-native'
import { useSendableIdentities } from '../hooks/useSendableIdentities'
import { useComposeStore } from '../stores/compose-store'
import { FromIdentityPicker } from './FromIdentityPicker'

export function ComposeFromRow() {
    const identities = useSendableIdentities()
    const mailboxId = useComposeStore((s) => s.mailboxId)
    const aliasId = useComposeStore((s) => s.aliasId)
    const setFromIdentity = useComposeStore((s) => s.setFromIdentity)

    const mutedColor = useThemeColor('muted-foreground')
    const fgColor = useThemeColor('foreground')
    const borderColor = useThemeColor('border')

    useEffect(() => {
        if (!mailboxId && identities.length > 0) {
            setFromIdentity(identities[0].mailboxId, null)
        }
    }, [mailboxId, identities, setFromIdentity])

    if (identities.length === 0) return null

    const resolved = identities.find((i) => i.mailboxId === mailboxId) ?? identities[0]
    const currentAddress = aliasId
        ? (resolved.aliases.find((a) => a.id === aliasId)?.address ?? resolved.primaryAddress)
        : resolved.primaryAddress

    const hasChoices = identities.length > 1 || identities.some((i) => i.aliases.length > 0)

    return (
        <View
            className="flex-row items-center px-3 py-1"
            style={{ minHeight: 36, borderBottomWidth: 1, borderBottomColor: borderColor }}
        >
            <Text style={{ fontSize: 13, width: 56, color: mutedColor }}>From</Text>
            <Text className="flex-1" style={{ fontSize: 13, color: fgColor }}>
                {resolved.mailboxDisplayName} &lt;{currentAddress}&gt;
            </Text>
            {hasChoices && (
                <FromIdentityPicker
                    identities={identities}
                    selectedMailboxId={resolved.mailboxId}
                    selectedAliasId={aliasId}
                    onSelect={setFromIdentity}
                />
            )}
        </View>
    )
}
