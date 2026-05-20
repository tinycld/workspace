import { Button, ButtonText } from '@tinycld/core/ui/button'
import { Modal, ModalBackdrop, ModalContent } from '@tinycld/core/ui/modal'
import { Pressable, Text, View } from 'react-native'

export type ConfirmDialogProps = {
    isOpen: boolean
    onClose: () => void
    onConfirm: () => void
    title: string
    message?: string
    confirmLabel?: string
    cancelLabel?: string
    isDestructive?: boolean
    isSubmitting?: boolean
}

export function ConfirmDialog({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    isDestructive = false,
    isSubmitting = false,
}: ConfirmDialogProps) {
    if (!isOpen) return null

    return (
        <Modal isOpen onClose={onClose}>
            <ModalBackdrop />
            <ModalContent className="w-[360px] p-4 gap-3">
                <Text className="text-foreground" style={{ fontSize: 20, fontWeight: '600' }}>
                    {title}
                </Text>
                {message ? <Text className="text-foreground text-sm">{message}</Text> : null}
                <View className="flex-row gap-3 justify-end">
                    <Pressable onPress={onClose} className="px-3 py-2" disabled={isSubmitting}>
                        <Text className="text-foreground" style={{ fontSize: 13 }}>
                            {cancelLabel}
                        </Text>
                    </Pressable>
                    <Button
                        onPress={onConfirm}
                        isDisabled={isSubmitting}
                        size="sm"
                        variant={isDestructive ? 'destructive' : 'default'}
                    >
                        <ButtonText>{confirmLabel}</ButtonText>
                    </Button>
                </View>
            </ModalContent>
        </Modal>
    )
}
