import { usePickFiles } from '@tinycld/core/file-viewer/use-pick-files'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useForm, zodResolver } from '@tinycld/core/ui/form'
import { useCallback } from 'react'
import { View } from 'react-native'
import { composeSchema, parseRecipients } from '../hooks/composeSchema'
import { useAttachments } from '../hooks/useAttachments'
import type { useCompose } from '../hooks/useComposeState'
import { useDefaultMailbox } from '../hooks/useDefaultMailbox'
import { useFileDrop } from '../hooks/useFileDrop'
import { useMailEditor } from '../hooks/useMailEditor'
import { useSendEmail } from '../hooks/useSendEmail'
import { useComposeStore } from '../stores/compose-store'
import { AttachmentRibbon } from './AttachmentRibbon'
import { ComposeFields } from './ComposeFields'
import { ComposeToolbar } from './ComposeToolbar'
import { DropOverlay } from './DropOverlay'

interface InlineComposeFormProps {
    replyContext: NonNullable<ReturnType<typeof useCompose>['replyContext']>
    onClose: () => void
}

export default function InlineComposeForm({ replyContext, onClose }: InlineComposeFormProps) {
    const borderColor = useThemeColor('border')
    const backgroundColor = useThemeColor('background')
    const mailboxId = useDefaultMailbox()
    const aliasId = useComposeStore((s) => s.aliasId)
    const { editor, EditorComponent, commands, toolbarState } = useMailEditor({
        placeholder: 'Compose reply',
        autofocus: true,
    })
    const { attachments, addFilesSafely, removeFile, clearAll: clearAttachments } = useAttachments()

    const toValue =
        replyContext.to.map((r) => (r.name ? `${r.name} <${r.email}>` : r.email)).join(', ') +
        (replyContext.to.length > 0 ? ', ' : '')
    const subjectValue = replyContext.subject.startsWith('Re:') ? replyContext.subject : `Re: ${replyContext.subject}`

    const {
        control,
        handleSubmit,
        reset,
        setError,
        formState: { errors },
    } = useForm({
        resolver: zodResolver(composeSchema),
        mode: 'onChange',
        defaultValues: { to: toValue, cc: '', bcc: '', subject: subjectValue },
    })

    const { send, isPending } = useSendEmail({
        onSuccess: () => {
            editor.clear()
            clearAttachments()
            reset({ to: '', cc: '', bcc: '', subject: '' })
            onClose()
        },
    })

    const onSend = handleSubmit(async (data) => {
        if (!mailboxId) {
            setError('to', { message: 'No mailbox configured — contact your admin' })
            return
        }

        const htmlBody = await editor.getHTML()
        const textBody = await editor.getText()

        const cc = data.cc ? parseRecipients(data.cc) : undefined
        const bcc = data.bcc ? parseRecipients(data.bcc) : undefined

        send({
            mailbox_id: mailboxId,
            alias_id: aliasId ?? undefined,
            to: parseRecipients(data.to),
            cc,
            bcc,
            subject: data.subject,
            html_body: htmlBody,
            text_body: textBody,
            in_reply_to_message_id: replyContext.messageId,
            attachments: attachments.map((a) => a.file),
        })
    })

    const { isDragging, dropRef } = useFileDrop({
        onFiles: addFilesSafely,
        isEnabled: !!mailboxId,
    })

    const { pickFiles, ActionSheetElement: PickerActionSheet } = usePickFiles()
    const handleAttach = useCallback(async () => {
        const picked = await pickFiles({ sources: ['photoLibrary', 'camera', 'documents'], multiple: true })
        if (picked.length > 0) addFilesSafely(picked.map((p) => p.file))
    }, [pickFiles, addFilesSafely])

    return (
        <View
            className="m-4 border rounded-lg"
            style={{
                minHeight: 200,
                borderColor,
                backgroundColor,
            }}
        >
            <View ref={dropRef} className="flex-1">
                <ComposeFields control={control} errors={errors} />
                <View className="p-3" style={{ minHeight: 120, maxHeight: 280 }}>
                    <EditorComponent />
                </View>
                <AttachmentRibbon isVisible={attachments.length > 0} attachments={attachments} onRemove={removeFile} />
                <ComposeToolbar
                    commands={commands}
                    toolbarState={toolbarState}
                    onDiscard={onClose}
                    onSend={onSend}
                    onAttach={handleAttach}
                    isPending={isPending}
                />
                <DropOverlay isVisible={isDragging} />
            </View>
            {PickerActionSheet}
        </View>
    )
}
