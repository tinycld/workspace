import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Forward, Reply, ReplyAll } from 'lucide-react-native'
import { lazy, Suspense } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useBreakpoint } from '@tinycld/core/components/workspace/useBreakpoint'
import { filterOwnAddresses, pickDefaultFrom } from '../hooks/defaultFromIdentity'
import { useCompose } from '../hooks/useComposeState'
import { useOpenReply } from '../hooks/useOpenReply'
import { useSendableIdentities } from '../hooks/useSendableIdentities'

// Lazy boundary keeps the rich-text editor (and its transitive
// prosemirror-view top-level DOM access) out of the static import
// graph that mounts at app launch via expo-router's <Stack>.
const InlineComposeForm = lazy(() => import('./InlineComposeForm'))

interface InlineReplyProps {
    messageId: string
    threadId: string
    subject: string
    senderName: string
    senderEmail: string
    recipientsTo: { name: string; email: string }[]
    recipientsCc: { name: string; email: string }[]
    mailboxId: string
}

export function InlineReply({
    messageId,
    threadId,
    subject,
    senderName,
    senderEmail,
    recipientsTo,
    recipientsCc,
    mailboxId,
}: InlineReplyProps) {
    const mutedColor = useThemeColor('muted-foreground')
    const borderColor = useThemeColor('border')
    const breakpoint = useBreakpoint()
    const isMobile = breakpoint === 'mobile'
    const { mode, replyContext, close } = useCompose()
    const openReply = useOpenReply()
    const identities = useSendableIdentities()

    const isInlineActive = mode === 'inline' && replyContext?.threadId === threadId

    const sentToAddresses = [...recipientsTo.map((r) => r.email), ...recipientsCc.map((r) => r.email)]

    const handleReply = () => {
        openReply({
            messageId,
            threadId,
            subject,
            to: [{ name: senderName, email: senderEmail }],
            mailboxId,
            sentToAddresses,
        })
    }

    const handleReplyAll = () => {
        const defaultFrom = pickDefaultFrom({
            mode: 'reply',
            identities,
            replyToAddresses: sentToAddresses,
        })
        const identity = identities.find((i) => i.mailboxId === defaultFrom.mailboxId)
        const rawTo = [{ name: senderName, email: senderEmail }, ...recipientsTo, ...recipientsCc]
        const filteredTo = identity ? filterOwnAddresses({ identity, recipients: rawTo }) : rawTo
        openReply({
            messageId,
            threadId,
            subject,
            to: filteredTo,
            mailboxId,
            sentToAddresses,
        })
    }

    const handleForward = () => {
        openReply({
            messageId,
            threadId,
            subject: `Fwd: ${subject}`,
            to: [],
            mailboxId,
            sentToAddresses,
        })
    }

    if (isInlineActive) {
        const formKey = `${replyContext.messageId}-${replyContext.to.length}`
        return (
            <Suspense fallback={null}>
                <InlineComposeForm key={formKey} replyContext={replyContext} onClose={close} />
            </Suspense>
        )
    }

    return (
        <View
            className="flex-row gap-2 p-4"
            style={{
                borderTopWidth: 1,
                borderTopColor: borderColor,
                flexWrap: isMobile ? 'wrap' : undefined,
            }}
        >
            <Pressable
                className="flex-row items-center px-4 py-2 rounded-full border"
                style={{
                    gap: 6,
                    borderColor,
                }}
                onPress={handleReply}
            >
                <Reply size={16} color={mutedColor} />
                <Text style={{ fontSize: 13, fontWeight: '500', color: mutedColor }}>Reply</Text>
            </Pressable>
            <Pressable
                className="flex-row items-center px-4 py-2 rounded-full border"
                style={{
                    gap: 6,
                    borderColor,
                }}
                onPress={handleReplyAll}
            >
                <ReplyAll size={16} color={mutedColor} />
                <Text style={{ fontSize: 13, fontWeight: '500', color: mutedColor }}>Reply all</Text>
            </Pressable>
            <Pressable
                className="flex-row items-center px-4 py-2 rounded-full border"
                style={{
                    gap: 6,
                    borderColor,
                }}
                onPress={handleForward}
            >
                <Forward size={16} color={mutedColor} />
                <Text style={{ fontSize: 13, fontWeight: '500', color: mutedColor }}>Forward</Text>
            </Pressable>
        </View>
    )
}
