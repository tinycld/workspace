import { Button, ButtonText } from '@tinycld/core/ui/button'
import { Modal, ModalBackdrop, ModalContent } from '@tinycld/core/ui/modal'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'

export type PromptDialogProps = {
    isOpen: boolean
    onClose: () => void
    onSubmit: (value: string) => void
    title: string
    description?: string
    placeholder?: string
    confirmLabel?: string
    cancelLabel?: string
    defaultValue?: string
    maxLength?: number
    required?: boolean
    isSubmitting?: boolean
}

export function PromptDialog({
    isOpen,
    onClose,
    onSubmit,
    title,
    description,
    placeholder,
    confirmLabel = 'Save',
    cancelLabel = 'Cancel',
    defaultValue = '',
    maxLength,
    required = false,
    isSubmitting = false,
}: PromptDialogProps) {
    const [value, setValue] = useState(defaultValue)

    useEffect(() => {
        if (isOpen) setValue(defaultValue)
    }, [isOpen, defaultValue])

    if (!isOpen) return null

    const trimmed = value.trim()
    const canSubmit = !isSubmitting && (!required || trimmed.length > 0)

    const handleSubmit = () => {
        if (!canSubmit) return
        onSubmit(trimmed)
    }

    return (
        <Modal isOpen onClose={onClose}>
            <ModalBackdrop />
            <ModalContent className="w-[360px] p-4 gap-3">
                <Text className="text-foreground" style={{ fontSize: 20, fontWeight: '600' }}>
                    {title}
                </Text>
                {description ? <Text className="text-muted text-sm">{description}</Text> : null}
                <View
                    className="flex-row border border-border rounded-lg px-3"
                    style={{ paddingVertical: 10 }}
                >
                    <PlainInput
                        value={value}
                        onChangeText={setValue}
                        placeholder={placeholder}
                        autoFocus
                        maxLength={maxLength}
                        onSubmitEditing={handleSubmit}
                        editable={!isSubmitting}
                        accessibilityLabel={title}
                        className="flex-1 text-foreground"
                        style={{ fontSize: 15 }}
                    />
                </View>
                <View className="flex-row gap-3 justify-end">
                    <Pressable onPress={onClose} className="px-3 py-2" disabled={isSubmitting}>
                        <Text className="text-foreground" style={{ fontSize: 13 }}>
                            {cancelLabel}
                        </Text>
                    </Pressable>
                    <Button onPress={handleSubmit} isDisabled={!canSubmit} size="sm">
                        <ButtonText>{confirmLabel}</ButtonText>
                    </Button>
                </View>
            </ModalContent>
        </Modal>
    )
}
