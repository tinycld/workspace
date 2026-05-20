import {
    AlertDialog,
    AlertDialogBackdrop,
    AlertDialogBody,
    AlertDialogContent,
    AlertDialogFooter,
} from '@tinycld/core/ui/alert-dialog'
import { Button, ButtonText } from '@tinycld/core/ui/button'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { Pressable, Text } from 'react-native'

interface SuretyGuardProps {
    children: (onOpen: () => void) => ReactNode
    message?: string
    confirmLabel?: string
    onConfirmed: () => void | Promise<void>
}

export function SuretyGuard({
    children,
    message = 'Are you sure? This cannot be undone.',
    confirmLabel = 'Yes',
    onConfirmed,
}: SuretyGuardProps) {
    const [open, setOpen] = useState(false)
    const [pending, setPending] = useState(false)

    const handleConfirm = async () => {
        setPending(true)
        try {
            await onConfirmed()
        } finally {
            setPending(false)
            setOpen(false)
        }
    }

    return (
        <>
            {children(() => setOpen(true))}
            <AlertDialog isOpen={open} onClose={() => setOpen(false)}>
                <AlertDialogBackdrop />
                <AlertDialogContent>
                    <AlertDialogBody>
                        <Text className="text-sm text-foreground">{message}</Text>
                    </AlertDialogBody>
                    <AlertDialogFooter>
                        <Pressable
                            disabled={pending}
                            onPress={() => setOpen(false)}
                            className="p-2"
                        >
                            <Text className="text-sm text-foreground">Cancel</Text>
                        </Pressable>
                        <Button
                            onPress={handleConfirm}
                            isDisabled={pending}
                            size="sm"
                            variant="destructive"
                        >
                            <ButtonText>{confirmLabel}</ButtonText>
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}

interface ConfirmTrashProps {
    children: (onOpen: () => void) => ReactNode
    itemName: string
    onConfirmed: () => void | Promise<void>
}

export function ConfirmTrash({ children, itemName, onConfirmed }: ConfirmTrashProps) {
    return (
        <SuretyGuard
            message={`Are you sure you want to move "${itemName}" to trash? It will be permanently removed after 30 days.`}
            confirmLabel="Move to trash"
            onConfirmed={onConfirmed}
        >
            {children}
        </SuretyGuard>
    )
}
