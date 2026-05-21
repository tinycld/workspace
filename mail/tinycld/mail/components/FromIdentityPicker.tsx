import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useState } from 'react'
import { Modal, Pressable, Text, View } from 'react-native'
import type { SendableIdentity } from '../hooks/flattenSendableIdentities'

interface Props {
    identities: SendableIdentity[]
    selectedMailboxId: string
    selectedAliasId: string | null
    onSelect: (mailboxId: string, aliasId: string | null) => void
}

export function FromIdentityPicker({ identities, selectedMailboxId, selectedAliasId, onSelect }: Props) {
    const [open, setOpen] = useState(false)
    const primaryColor = useThemeColor('primary')
    const fgColor = useThemeColor('foreground')
    const mutedColor = useThemeColor('muted-foreground')
    const surfaceBg = useThemeColor('surface-secondary')

    return (
        <>
            <Pressable onPress={() => setOpen(true)}>
                <Text style={{ fontSize: 13, color: primaryColor, textDecorationLine: 'underline' }}>Change</Text>
            </Pressable>

            <Modal transparent visible={open} onRequestClose={() => setOpen(false)}>
                <Pressable
                    className="flex-1 items-center justify-center"
                    style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
                    onPress={() => setOpen(false)}
                >
                    <View className="rounded-xl p-3 gap-3" style={{ backgroundColor: surfaceBg, minWidth: 320 }}>
                        {identities.map((identity) => (
                            <View key={identity.mailboxId} className="gap-1">
                                <Text
                                    style={{
                                        fontSize: 12,
                                        fontWeight: '600',
                                        color: mutedColor,
                                        textTransform: 'uppercase',
                                    }}
                                >
                                    {identity.mailboxDisplayName}
                                </Text>
                                <IdentityRow
                                    label={`${identity.mailboxDisplayName} <${identity.primaryAddress}>`}
                                    isSelected={selectedMailboxId === identity.mailboxId && !selectedAliasId}
                                    onPress={() => {
                                        onSelect(identity.mailboxId, null)
                                        setOpen(false)
                                    }}
                                    color={fgColor}
                                />
                                {identity.aliases.map((alias) => (
                                    <IdentityRow
                                        key={alias.id}
                                        label={alias.address}
                                        isSelected={
                                            selectedMailboxId === identity.mailboxId && selectedAliasId === alias.id
                                        }
                                        onPress={() => {
                                            onSelect(identity.mailboxId, alias.id)
                                            setOpen(false)
                                        }}
                                        color={fgColor}
                                    />
                                ))}
                            </View>
                        ))}
                    </View>
                </Pressable>
            </Modal>
        </>
    )
}

function IdentityRow({
    label,
    isSelected,
    onPress,
    color,
}: {
    label: string
    isSelected: boolean
    onPress: () => void
    color: string
}) {
    return (
        <Pressable
            onPress={onPress}
            className="flex-row items-center px-2 py-1.5 rounded-md"
            style={{ backgroundColor: isSelected ? 'rgba(0, 0, 0, 0.08)' : 'transparent' }}
        >
            <Text style={{ fontSize: 13, color }}>{label}</Text>
        </Pressable>
    )
}
