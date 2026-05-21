import { PB_SERVER_ADDR } from '@tinycld/core/lib/config'
import { captureException } from '@tinycld/core/lib/errors'
import { pb } from '@tinycld/core/lib/pocketbase'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { FormErrorSummary, TextInput, useForm, z, zodResolver } from '@tinycld/core/ui/form'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { CheckCircle2, KeyRound } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'

interface InviteInfo {
    username: string
    email: string
    orgName: string
    orgSlug: string
    role: string
}

type LoadState =
    | { status: 'loading' }
    | { status: 'invalid'; message: string }
    | { status: 'ready'; info: InviteInfo }

const acceptSchema = z
    .object({
        name: z.string().min(1, 'Name is required'),
        password: z.string().min(8, 'Min 8 characters'),
        confirmPassword: z.string(),
    })
    .refine(v => v.password === v.confirmPassword, {
        message: 'Passwords must match',
        path: ['confirmPassword'],
    })

export default function AcceptInvite() {
    const { token } = useLocalSearchParams<{ token: string }>()
    const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' })

    useEffect(() => {
        if (!token) {
            setLoadState({ status: 'invalid', message: 'No invitation token provided.' })
            return
        }
        let cancelled = false
        ;(async () => {
            try {
                const res = await fetch(`${PB_SERVER_ADDR}/api/accept-invite/${token}`)
                if (cancelled) return
                if (!res.ok) {
                    const body = (await res.json().catch(() => null)) as { error?: string } | null
                    setLoadState({
                        status: 'invalid',
                        message: body?.error ?? 'This invitation is not valid.',
                    })
                    return
                }
                const info = (await res.json()) as InviteInfo
                setLoadState({ status: 'ready', info })
            } catch (err) {
                if (cancelled) return
                captureException('Failed to load invitation', err)
                setLoadState({
                    status: 'invalid',
                    message: 'Could not reach the server. Try again in a moment.',
                })
            }
        })()
        return () => {
            cancelled = true
        }
    }, [token])

    return (
        <View className="flex-1 items-center justify-center p-5 bg-background">
            {loadState.status === 'loading' && <LoadingCard />}
            {loadState.status === 'invalid' && <InvalidCard message={loadState.message} />}
            {loadState.status === 'ready' && <AcceptForm token={token} info={loadState.info} />}
        </View>
    )
}

function LoadingCard() {
    const mutedColor = useThemeColor('muted-foreground')
    return <ActivityIndicator size="large" color={mutedColor} />
}

function InvalidCard({ message }: { message: string }) {
    const router = useRouter()

    return (
        <View
            className="gap-4 p-6 rounded-xl border border-border items-center bg-surface-secondary"
            style={{ maxWidth: 400, width: '100%' }}
        >
            <Text className="text-lg font-semibold text-foreground">Invitation unavailable</Text>
            <Text className="text-center text-sm text-muted-foreground">{message}</Text>
            <Pressable
                onPress={() => router.replace('/')}
                className="px-4 py-2 rounded-lg bg-primary"
            >
                <Text className="font-semibold text-primary-foreground">Go to sign in</Text>
            </Pressable>
        </View>
    )
}

function AcceptForm({ token, info }: { token: string; info: InviteInfo }) {
    const router = useRouter()
    const fgColor = useThemeColor('foreground')
    const primaryBg = useThemeColor('primary')

    const [submitError, setSubmitError] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [isSuccess, setIsSuccess] = useState(false)

    const {
        control,
        handleSubmit,
        formState: { errors, isSubmitted },
    } = useForm({
        resolver: zodResolver(acceptSchema),
        defaultValues: { name: '', password: '', confirmPassword: '' },
        mode: 'onChange',
    })

    const onSubmit = handleSubmit(async data => {
        setSubmitError(null)
        setIsSubmitting(true)
        try {
            const res = await fetch(`${PB_SERVER_ADDR}/api/accept-invite/${token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: data.name, password: data.password }),
            })
            if (!res.ok) {
                const body = (await res.json().catch(() => null)) as { message?: string } | null
                throw new Error(body?.message ?? 'Failed to accept invitation')
            }
            const { username, orgSlug } = (await res.json()) as {
                username: string
                email: string
                orgSlug: string
            }

            await pb.collection('users').authWithPassword(username, data.password)
            setIsSuccess(true)
            router.replace(`/a/${orgSlug}`)
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to accept invitation'
            captureException('Accept invite failed', err)
            setSubmitError(message)
        } finally {
            setIsSubmitting(false)
        }
    })

    return (
        <View
            className="gap-4 p-6 rounded-xl border border-border bg-surface-secondary"
            style={{ maxWidth: 440, width: '100%' }}
        >
            <View className="gap-2 items-center">
                <View className="size-10 rounded-lg items-center justify-center bg-surface">
                    {isSuccess ? (
                        <CheckCircle2 size={20} color={primaryBg} />
                    ) : (
                        <KeyRound size={18} color={fgColor} />
                    )}
                </View>
                <Text className="text-xl font-semibold text-foreground text-center">
                    Welcome to {info.orgName}
                </Text>
                <Text
                    className="text-center text-[13px] text-muted-foreground"
                    style={{ lineHeight: 18 }}
                >
                    Signing in as{' '}
                    <Text className="font-semibold text-foreground">@{info.username}</Text> ·{' '}
                    {info.role}
                </Text>
                {info.email ? (
                    <Text className="text-center text-xs text-muted-foreground">{info.email}</Text>
                ) : null}
                <Text className="text-center text-[13px] text-muted-foreground mt-1">
                    Choose a password to finish setting up your account.
                </Text>
            </View>

            <FormErrorSummary errors={errors} isEnabled={isSubmitted} />

            {submitError && (
                <View className="rounded-lg p-2 bg-danger-soft">
                    <Text className="text-xs text-danger">{submitError}</Text>
                </View>
            )}

            <TextInput control={control} name="name" label="Name" placeholder="Your name" />

            <TextInput
                control={control}
                name="password"
                label="Password"
                placeholder="At least 8 characters"
                secureTextEntry
                autoCapitalize="none"
            />

            <TextInput
                control={control}
                name="confirmPassword"
                label="Confirm password"
                placeholder="Re-enter password"
                secureTextEntry
                autoCapitalize="none"
            />

            <Pressable
                onPress={onSubmit}
                disabled={isSubmitting || isSuccess}
                className={`px-4 py-3 rounded-lg items-center bg-primary ${isSubmitting || isSuccess ? 'opacity-60' : 'opacity-100'}`}
            >
                <Text className="font-semibold text-primary-foreground">
                    {isSuccess
                        ? 'Signed in, redirecting...'
                        : isSubmitting
                          ? 'Setting password...'
                          : 'Set password and sign in'}
                </Text>
            </Pressable>
        </View>
    )
}
