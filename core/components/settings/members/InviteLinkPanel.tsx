import { useMutation } from '@tinycld/core/lib/mutations'
import { pb } from '@tinycld/core/lib/pocketbase'
import * as Clipboard from 'expo-clipboard'
import { useEffect, useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'

export type InviteLinkPanelProps = {
    userOrgId: string
    initialUrl?: string
}

type LinkState =
    | { kind: 'loading' }
    | { kind: 'ready'; url: string }
    | { kind: 'expired' }
    | { kind: 'error'; message: string }

export function InviteLinkPanel({ userOrgId, initialUrl }: InviteLinkPanelProps) {
    const [state, setState] = useState<LinkState>(
        initialUrl ? { kind: 'ready', url: initialUrl } : { kind: 'loading' }
    )

    useEffect(() => {
        if (initialUrl) return
        let cancelled = false
        ;(async () => {
            try {
                const res = await pb.send<{ inviteUrl: string }>(`/api/invite-link/${userOrgId}`, {
                    method: 'GET',
                })
                if (!cancelled) setState({ kind: 'ready', url: res.inviteUrl })
            } catch (err) {
                if (cancelled) return
                const status = (err as { status?: number })?.status
                if (status === 404) {
                    setState({ kind: 'expired' })
                    return
                }
                const message =
                    (err as { message?: string })?.message ?? 'Failed to load invite link'
                setState({ kind: 'error', message })
            }
        })()
        return () => {
            cancelled = true
        }
    }, [userOrgId, initialUrl])

    const rotate = useMutation({
        mutationFn: async () => {
            return pb.send<{ inviteUrl: string }>(`/api/invite-link/${userOrgId}/rotate`, {
                method: 'POST',
            })
        },
        onSuccess: data => setState({ kind: 'ready', url: data.inviteUrl }),
    })

    if (state.kind === 'loading') {
        return (
            <View testID="invite-link-panel-loading">
                <Text className="text-muted-foreground">Loading…</Text>
            </View>
        )
    }
    if (state.kind === 'expired') {
        return <ExpiredView onRotate={() => rotate.mutate()} pending={rotate.isPending} />
    }
    if (state.kind === 'error') {
        return (
            <View testID="invite-link-panel-error">
                <Text className="text-destructive">{state.message}</Text>
            </View>
        )
    }
    return (
        <ReadyView
            url={state.url}
            userOrgId={userOrgId}
            onRotate={() => rotate.mutate()}
            rotatePending={rotate.isPending}
        />
    )
}

function ExpiredView({ onRotate, pending }: { onRotate: () => void; pending: boolean }) {
    return (
        <View testID="invite-link-panel-expired" className="gap-2">
            <Text className="text-foreground">This invite has expired.</Text>
            <Pressable testID="invite-link-rotate" onPress={onRotate} disabled={pending}>
                <Text className="text-primary">
                    {pending ? 'Generating…' : 'Generate new link'}
                </Text>
            </Pressable>
        </View>
    )
}

type ReadyViewProps = {
    url: string
    userOrgId: string
    onRotate: () => void
    rotatePending: boolean
}

function ReadyView({ url, userOrgId, onRotate, rotatePending }: ReadyViewProps) {
    const [copied, setCopied] = useState(false)
    const [altEmail, setAltEmail] = useState('')
    const [showSend, setShowSend] = useState(false)

    const send = useMutation({
        mutationFn: async () => {
            return pb.send<{ delivered: true }>(`/api/invite-link/${userOrgId}/send`, {
                method: 'POST',
                body: JSON.stringify({ email: altEmail }),
                headers: { 'Content-Type': 'application/json' },
            })
        },
    })

    const copy = async () => {
        await Clipboard.setStringAsync(url)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
    }

    return (
        <View testID="invite-link-panel-ready" className="gap-3">
            <Text testID="invite-link-url" className="text-foreground" selectable>
                {url}
            </Text>
            <Pressable testID="invite-link-copy" onPress={copy}>
                <Text className="text-primary">{copied ? 'Copied!' : 'Copy link'}</Text>
            </Pressable>
            <Pressable testID="invite-link-rotate" onPress={onRotate} disabled={rotatePending}>
                <Text className="text-muted-foreground">
                    {rotatePending ? 'Generating…' : 'Generate new link'}
                </Text>
            </Pressable>

            <Pressable testID="invite-link-send-toggle" onPress={() => setShowSend(s => !s)}>
                <Text className="text-foreground">
                    {showSend ? 'Hide email send' : 'Or email this link to a different address'}
                </Text>
            </Pressable>
            <SendForm
                isVisible={showSend}
                altEmail={altEmail}
                setAltEmail={setAltEmail}
                send={send}
            />
        </View>
    )
}

type SendFormProps = {
    isVisible: boolean
    altEmail: string
    setAltEmail: (v: string) => void
    send: ReturnType<typeof useMutation<{ delivered: true }, Error, void>>
}

function SendForm({ isVisible, altEmail, setAltEmail, send }: SendFormProps) {
    if (!isVisible) return null
    return (
        <View className="gap-2">
            <TextInput
                testID="invite-link-alt-email"
                value={altEmail}
                onChangeText={setAltEmail}
                placeholder="recipient@example.com"
                autoCapitalize="none"
                keyboardType="email-address"
                className="text-foreground border-border border rounded p-2"
            />
            <Pressable
                testID="invite-link-send"
                onPress={() => send.mutate()}
                disabled={send.isPending || !altEmail}
            >
                <Text className="text-primary">
                    {send.isPending ? 'Sending…' : send.isSuccess ? 'Sent' : 'Send'}
                </Text>
            </Pressable>
            {send.isError && (
                <Text testID="invite-link-send-error" className="text-destructive">
                    {extractSendError(send.error)}
                </Text>
            )}
        </View>
    )
}

function extractSendError(err: unknown): string {
    if (err && typeof err === 'object') {
        const e = err as { response?: { error?: string }; message?: string }
        if (e.response?.error) return e.response.error
        if (e.message) return e.message
    }
    return 'Send failed'
}
