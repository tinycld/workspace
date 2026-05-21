import { useSaveDriveVersion } from '@tinycld/drive/hooks/useSaveDriveVersion'
import { PromptDialog } from '@tinycld/core/ui/PromptDialog'

type SaveVersionDialogProps = {
    isOpen: boolean
    onClose: () => void
    workbookId: string
}

const dateLabel = (now: Date) =>
    `Saved ${now.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} at ${now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`

export function SaveVersionDialog({ isOpen, onClose, workbookId }: SaveVersionDialogProps) {
    const save = useSaveDriveVersion()

    const handleSubmit = (value: string) => {
        const label = value.length > 0 ? value : dateLabel(new Date())
        save.mutate(
            { itemId: workbookId, label },
            {
                onSuccess: () => onClose(),
            }
        )
    }

    return (
        <PromptDialog
            isOpen={isOpen}
            onClose={onClose}
            onSubmit={handleSubmit}
            title="Save version"
            description="Add an optional description so you can find this version later."
            placeholder="What changed in this version?"
            confirmLabel="Save"
            maxLength={500}
            isSubmitting={save.isPending}
        />
    )
}
