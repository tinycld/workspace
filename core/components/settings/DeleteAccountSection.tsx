import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { DeleteAccountModal } from './DeleteAccountModal'

export function DeleteAccountSection() {
    const [isOpen, setIsOpen] = useState(false)

    return (
        <View className="gap-3">
            <Text className="text-xl font-bold text-foreground">Account</Text>
            <View className="rounded-xl border border-border bg-surface-secondary p-4 gap-2">
                <Text className="text-base font-semibold text-foreground">Delete account</Text>
                <Text className="text-[13px] text-muted-foreground">
                    Permanently remove your account and associated data from this server.
                </Text>
                <Pressable
                    onPress={() => setIsOpen(true)}
                    className="self-start rounded-lg mt-1 px-3 py-2 bg-danger"
                >
                    <Text className="text-danger-foreground font-semibold">Delete my account</Text>
                </Pressable>
            </View>
            <DeleteAccountModal isVisible={isOpen} onClose={() => setIsOpen(false)} />
        </View>
    )
}
