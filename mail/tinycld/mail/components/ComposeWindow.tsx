import { useBreakpoint } from '@tinycld/core/components/workspace/useBreakpoint'
import { usePickFiles } from '@tinycld/core/file-viewer/use-pick-files'
import { performMutations } from '@tinycld/core/lib/mutations'
import { notify } from '@tinycld/core/lib/notify'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { type Shortcut, useRegisterShortcut, useShortcutScope } from '@tinycld/core/lib/shortcuts'
import { FormErrorSummary, useForm, zodResolver } from '@tinycld/core/ui/form'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Platform, View } from 'react-native'
import { composeSchema, parseRecipients } from '../hooks/composeSchema'
import { useAttachments } from '../hooks/useAttachments'
import { useCompose } from '../hooks/useComposeState'
import { useFileDrop } from '../hooks/useFileDrop'
import { setContentWhenReady, useMailEditor } from '../hooks/useMailEditor'
import { useMailSendReadiness } from '../hooks/useMailSendReadiness'
import { useSaveDraft } from '../hooks/useSaveDraft'
import { useSendEmail } from '../hooks/useSendEmail'
import { useComposeStore } from '../stores/compose-store'
import { AttachmentRibbon } from './AttachmentRibbon'
import { ComposeFields } from './ComposeFields'
import { ComposeFromRow } from './ComposeFromRow'
import { ComposeHeader } from './ComposeHeader'
import { ComposeToolbar } from './ComposeToolbar'
import { DropOverlay } from './DropOverlay'

export type { ComposeFormData } from '../hooks/composeSchema'

const webShadow = Platform.OS === 'web' ? ({ boxShadow: '0 8px 32px rgba(0,0,0,0.24)' } as Record<string, unknown>) : {}

interface ComposeWindowProps {
    isVisible: boolean
}

export function ComposeWindow({ isVisible }: ComposeWindowProps) {
    const { mode, replyContext, draftContext, minimize, maximize, open, close } = useCompose()
    const breakpoint = useBreakpoint()
    const readiness = useMailSendReadiness()
    const mailboxId = readiness.mailboxId
    const aliasId = useComposeStore((s) => s.aliasId)
    const draftIdRef = useRef<string | null>(null)
    const toastedBlockerRef = useRef<string | null>(null)
    const [headerTitle, setHeaderTitle] = useState('')
    const { attachments, addFilesSafely, removeFile, clearAll: clearAttachments } = useAttachments()
    useEffect(() => {
        if (!isVisible) {
            toastedBlockerRef.current = null
            return
        }
        if (!readiness.blocker || !readiness.message) return
        if (toastedBlockerRef.current === readiness.blocker) return
        toastedBlockerRef.current = readiness.blocker
        const event = readiness.blocker === 'domain-unverified' ? 'mail.send_blocked_warn' : 'mail.send_blocked_error'
        notify.emit({
            event,
            title: "Can't send mail",
            body: readiness.message,
            durationMs: 8000,
            data: { reason: readiness.message },
        })
    }, [isVisible, readiness.blocker, readiness.message])

    const { editor, EditorComponent, commands, toolbarState } = useMailEditor({
        placeholder: 'Compose email',
    })
    const editorRef = useRef(editor)
    editorRef.current = editor

    const {
        control,
        handleSubmit,
        reset,
        getValues,
        formState: { errors, isSubmitted },
    } = useForm({
        resolver: zodResolver(composeSchema),
        mode: 'onChange',
        defaultValues: { to: '', cc: '', bcc: '', subject: '' },
    })

    const onSubjectBlur = useCallback(() => setHeaderTitle(getValues('subject')), [getValues])

    useEffect(() => {
        if (!isVisible) return
        let cleanup: (() => void) | undefined
        if (draftContext) {
            draftIdRef.current = draftContext.messageId
            const formatRecipients = (recipients: { name: string; email: string }[]) =>
                recipients.map((r) => (r.name ? `${r.name} <${r.email}>` : r.email)).join(', ')
            reset({
                to: formatRecipients(draftContext.to),
                cc: formatRecipients(draftContext.cc),
                bcc: formatRecipients(draftContext.bcc),
                subject: draftContext.subject,
            })
            setHeaderTitle(draftContext.subject)
            cleanup = setContentWhenReady(editorRef.current, draftContext.htmlBody || draftContext.textBody || '')
        } else if (replyContext) {
            draftIdRef.current = null
            const toValue =
                replyContext.to.map((r) => (r.name ? `${r.name} <${r.email}>` : r.email)).join(', ') +
                (replyContext.to.length > 0 ? ', ' : '')
            const subjectPrefix = replyContext.subject.startsWith('Re:')
                ? replyContext.subject
                : `Re: ${replyContext.subject}`
            reset({ to: toValue, cc: '', bcc: '', subject: subjectPrefix })
            setHeaderTitle(subjectPrefix)
            // To and Subject are pre-filled; the user almost always wants to
            // type the body next.
            editorRef.current.focus('start')
        } else {
            draftIdRef.current = null
            reset({ to: '', cc: '', bcc: '', subject: '' })
            setHeaderTitle('')
            editorRef.current.clear()
        }
        return () => cleanup?.()
    }, [isVisible, replyContext, draftContext, reset])

    const [messagesCollection] = useStore('mail_messages')

    const deleteDraftMessage = async () => {
        const id = draftIdRef.current
        if (!id) return
        draftIdRef.current = null
        await performMutations(function* () {
            yield messagesCollection.delete(id)
        })
    }

    const { send, isPending } = useSendEmail({
        onSuccess: async () => {
            await deleteDraftMessage()
            editor.clear()
            clearAttachments()
            reset({ to: '', cc: '', bcc: '', subject: '' })
            close()
        },
    })

    const { saveDraft } = useSaveDraft()

    const { isDragging, dropRef } = useFileDrop({
        onFiles: addFilesSafely,
        isEnabled: !!mailboxId,
    })

    const { pickFiles, ActionSheetElement: PickerActionSheet } = usePickFiles()
    const handleAttach = useCallback(async () => {
        const picked = await pickFiles({ sources: ['photoLibrary', 'camera', 'documents'], multiple: true })
        if (picked.length > 0) addFilesSafely(picked.map((p) => p.file))
    }, [pickFiles, addFilesSafely])

    const handleClose = async () => {
        const text = await editor.getText()
        if (!text?.trim() || !mailboxId) {
            close()
            return
        }

        const data = getValues()
        const htmlBody = await editor.getHTML()
        const to = data.to ? parseRecipients(data.to) : undefined
        const cc = data.cc ? parseRecipients(data.cc) : undefined
        const bcc = data.bcc ? parseRecipients(data.bcc) : undefined

        saveDraft({
            mailbox_id: mailboxId,
            alias_id: aliasId ?? undefined,
            message_id: draftIdRef.current ?? undefined,
            to,
            cc,
            bcc,
            subject: data.subject,
            html_body: htmlBody,
            text_body: text,
            attachments: attachments.map((a) => a.file),
        })

        draftIdRef.current = null
        editor.clear()
        clearAttachments()
        reset({ to: '', cc: '', bcc: '', subject: '' })
        close()
    }

    if (!isVisible) return null

    const isMinimized = mode === 'minimized'
    const isMaximized = mode === 'maximized'
    const isNotDesktop = breakpoint !== 'desktop'

    const modeStyles = {
        open: { bottom: 0, right: 16, width: 500, height: 560 },
        minimized: { bottom: 0, right: 16, width: 300, height: 40 },
        maximized: {
            position: 'relative' as const,
            width: '75%' as const,
            maxWidth: 900,
            height: '85%' as const,
            maxHeight: 800,
        },
        closed: { bottom: 0, right: 16, width: 500, height: 560 },
        inline: { bottom: 0, right: 16, width: 500, height: 560 },
    }

    const fullscreenStyle = { top: 0, left: 0, right: 0, bottom: 0 }
    const windowStyle = isNotDesktop ? fullscreenStyle : modeStyles[mode]

    const onSend = handleSubmit(async (data) => {
        if (!mailboxId) return

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
            in_reply_to_message_id: replyContext?.messageId,
            attachments: attachments.map((a) => a.file),
        })
    })

    const composeWindow = (
        <View
            className="absolute border border-border bg-background rounded-lg"
            style={[
                {
                    zIndex: 1000,
                },
                windowStyle,
                webShadow,
            ]}
        >
            <ComposeHeader
                mode={mode}
                title={headerTitle}
                onMinimize={isMinimized ? open : minimize}
                onMaximize={isMaximized ? open : maximize}
                onClose={handleClose}
            />
            <View ref={dropRef} className={isMinimized ? 'hidden' : 'flex-1'}>
                <ComposeFromRow />
                <ComposeFields control={control} errors={errors} onSubjectBlur={onSubjectBlur} />
                <View className="px-3 pt-2">
                    <FormErrorSummary errors={errors} isEnabled={isSubmitted} />
                </View>
                <View className="flex-1 p-3">
                    <EditorComponent />
                </View>
                <AttachmentRibbon isVisible={attachments.length > 0} attachments={attachments} onRemove={removeFile} />
                <ComposeToolbar
                    commands={commands}
                    toolbarState={toolbarState}
                    onDiscard={close}
                    onSend={onSend}
                    onAttach={handleAttach}
                    isPending={isPending}
                    isSendDisabled={!mailboxId}
                />
                <DropOverlay isVisible={isDragging} />
            </View>
        </View>
    )

    const showBackdrop = isMaximized && !isNotDesktop

    return (
        <View
            className="absolute top-0 left-0 right-0 bottom-0"
            style={{
                zIndex: 1000,
                alignItems: showBackdrop ? 'center' : undefined,
                justifyContent: showBackdrop ? 'center' : undefined,
                backgroundColor: showBackdrop ? 'rgba(0,0,0,0.3)' : undefined,
            }}
            pointerEvents={showBackdrop ? 'auto' : 'box-none'}
        >
            <ComposeShortcuts onSend={onSend} />
            {composeWindow}
            {PickerActionSheet}
        </View>
    )
}

function ComposeShortcuts({ onSend }: { onSend: () => void }) {
    useShortcutScope('compose')
    const sendRef = useRef(onSend)
    sendRef.current = onSend
    const shortcut = useMemo<Shortcut>(
        () => ({
            id: 'mail.compose.send',
            keys: '$mod+Enter',
            scope: 'compose',
            group: 'Mail',
            description: 'Send email',
            allowInInputs: true,
            run: () => sendRef.current(),
        }),
        []
    )
    useRegisterShortcut(shortcut)
    return null
}

export default ComposeWindow
