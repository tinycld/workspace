import { ConnectIllustration } from '@tinycld/core/components/connect/ConnectIllustration'
import { getCoreConfigOptional } from '@tinycld/core/lib/core-config'
import {
    normalizeAddress,
    probe,
    setResolvedAddress,
    writeCached,
} from '@tinycld/core/lib/server-address'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { TextInput, useForm, z, zodResolver } from '@tinycld/core/ui/form'
import { router, useLocalSearchParams } from 'expo-router'
import { ChevronDown, Globe, Server, X } from 'lucide-react-native'
import { useState } from 'react'
import {
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    Text,
    View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

const FALLBACK_DEFAULT_SERVER = 'https://tinycld.org'

const urlSchema = z.object({
    url: z.string().min(1, 'Enter a server address.'),
})

export default function Connect() {
    const { backTo } = useLocalSearchParams<{ backTo?: string }>()
    const config = getCoreConfigOptional()
    const brandName = config?.brandName ?? 'TinyCld'
    const defaultServer = config?.defaultServer ?? FALLBACK_DEFAULT_SERVER
    const defaultServerLabel = hostLabel(defaultServer) ?? 'tinycld.org'

    const [sheetOpen, setSheetOpen] = useState(false)
    const [busyDefault, setBusyDefault] = useState(false)
    const [busyCustom, setBusyCustom] = useState(false)
    const [submitError, setSubmitError] = useState<string | null>(null)

    const fg = useThemeColor('foreground')
    const muted = useThemeColor('muted-foreground')

    const { control, handleSubmit, reset } = useForm({
        resolver: zodResolver(urlSchema),
        defaultValues: { url: '' },
        mode: 'onChange',
    })

    async function connectTo(addr: string) {
        await probe(addr)
        await writeCached(addr)
        setResolvedAddress(addr)
        const target = backTo?.startsWith('/') ? backTo : '/'
        router.replace(target)
    }

    async function onUseDefault() {
        setSubmitError(null)
        setBusyDefault(true)
        try {
            await connectTo(normalizeAddress(defaultServer))
        } catch (err) {
            const reason = err instanceof Error ? err.message : 'Connection failed'
            setSubmitError(`Couldn't reach ${defaultServerLabel}: ${reason}`)
            setBusyDefault(false)
        }
    }

    function openSheet() {
        setSubmitError(null)
        setSheetOpen(true)
    }

    function closeSheet() {
        setSheetOpen(false)
        setSubmitError(null)
        reset({ url: '' })
    }

    const onSubmitCustom = handleSubmit(async ({ url }) => {
        setSubmitError(null)
        setBusyCustom(true)
        const addr = normalizeAddress(url)
        try {
            await connectTo(addr)
        } catch (err) {
            const reason = err instanceof Error ? err.message : 'Connection failed'
            setSubmitError(`Couldn't reach ${addr}: ${reason}`)
            setBusyCustom(false)
        }
    })

    const busy = busyDefault || busyCustom

    return (
        <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']}>
            <ScrollView
                contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 28, paddingBottom: 32 }}
                showsVerticalScrollIndicator={false}
            >
                <View className="flex-row items-center gap-3 mt-4">
                    <BrandMark name={brandName} />
                </View>

                <View className="mt-8 mb-6">
                    <ConnectIllustration height={130} />
                </View>

                <View className="flex-row items-center gap-2 mb-2">
                    <View className="w-[18px] h-px bg-primary" />
                    <Text
                        className="text-[11px] font-semibold text-primary"
                        style={{ letterSpacing: 2 }}
                    >
                        WELCOME
                    </Text>
                </View>

                <Text
                    className="text-foreground text-[32px] font-semibold"
                    style={{
                        lineHeight: 36,
                        letterSpacing: -0.8,
                        fontFamily: 'Georgia',
                    }}
                >
                    Pick a place to keep{' '}
                    <Text
                        className="italic font-normal text-primary"
                        style={{ fontFamily: 'Georgia' }}
                    >
                        your stuff.
                    </Text>
                </Text>

                <Text
                    className="text-foreground text-[15px] mt-3.5"
                    style={{
                        lineHeight: 22,
                        opacity: 0.78,
                        maxWidth: 360,
                    }}
                >
                    {brandName} stores everything on a server you choose — no shared cloud, no
                    telemetry, nothing in our hands.
                </Text>

                {submitError && !sheetOpen ? (
                    <View className="mt-5 rounded-lg p-3 bg-danger-soft">
                        <Text className="text-xs text-danger">{submitError}</Text>
                    </View>
                ) : null}

                <View className="flex-1" />

                <View className="gap-2.5 mt-7">
                    <PrimaryCta
                        testID="connect-use-default"
                        label={busyDefault ? 'Connecting…' : `Use ${defaultServerLabel}`}
                        onPress={onUseDefault}
                        disabled={busy}
                    />
                    <Pressable
                        onPress={openSheet}
                        disabled={busy}
                        className={`rounded-xl border border-border bg-surface flex-row items-center justify-between px-4 py-3.5 ${busy ? 'opacity-50' : 'opacity-100'}`}
                    >
                        <View className="flex-row items-center gap-3">
                            <Server size={16} color={fg} />
                            <Text className="text-foreground text-sm font-medium">
                                I host my own server
                            </Text>
                        </View>
                        <ChevronDown size={16} color={muted} />
                    </Pressable>
                </View>
            </ScrollView>

            <Modal
                visible={sheetOpen}
                transparent
                animationType="slide"
                onRequestClose={closeSheet}
            >
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    className="flex-1"
                >
                    <Pressable
                        onPress={closeSheet}
                        className="flex-1"
                        style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}
                    />
                    <View
                        className="bg-background px-6 pt-3 pb-8"
                        style={{
                            borderTopLeftRadius: 24,
                            borderTopRightRadius: 24,
                        }}
                    >
                        <SafeAreaView edges={['bottom']}>
                            <View className="w-[38px] h-1 rounded-sm bg-border self-center mb-[18px]" />
                            <View className="flex-row items-start justify-between mb-3">
                                <View className="flex-1 pr-3">
                                    <Text
                                        className="text-foreground text-[22px] font-semibold"
                                        style={{
                                            letterSpacing: -0.4,
                                            fontFamily: 'Georgia',
                                        }}
                                    >
                                        Connect your server
                                    </Text>
                                    <Text
                                        className="mt-1.5 text-[13px] text-muted-foreground"
                                        style={{ lineHeight: 19 }}
                                    >
                                        Enter the address where your {brandName} server is running.
                                        We'll check it and remember it for next time.
                                    </Text>
                                </View>
                                <Pressable
                                    onPress={closeSheet}
                                    accessibilityLabel="Close"
                                    className="w-8 h-8 rounded-full border border-border items-center justify-center"
                                >
                                    <X size={14} color={fg} />
                                </Pressable>
                            </View>

                            <TextInput
                                control={control}
                                name="url"
                                label="Server address"
                                placeholder="https://pb.example.com"
                                autoCapitalize="none"
                                autoCorrect={false}
                                keyboardType="url"
                                hint="Usually starts with https://. If you skip the protocol, we'll add one."
                                autoFocus
                            />

                            {submitError ? (
                                <View className="rounded-lg p-3 bg-danger-soft mb-3">
                                    <Text className="text-xs text-danger">{submitError}</Text>
                                </View>
                            ) : null}

                            <PrimaryCta
                                label={busyCustom ? 'Connecting…' : 'Connect'}
                                onPress={onSubmitCustom}
                                disabled={busy}
                            />
                        </SafeAreaView>
                    </View>
                </KeyboardAvoidingView>
            </Modal>
        </SafeAreaView>
    )
}

function BrandMark({ name }: { name: string }) {
    const initial = name.charAt(0).toUpperCase()
    return (
        <View className="flex-row items-center gap-2.5">
            <View className="w-9 h-9 rounded-[10px] bg-foreground items-center justify-center relative">
                <Text
                    className="text-background text-lg font-bold"
                    style={{ fontFamily: 'Georgia' }}
                >
                    {initial}
                </Text>
                <View className="absolute top-[5px] right-[5px] w-1.5 h-1.5 rounded-full bg-primary" />
            </View>
            <View>
                <Text
                    className="text-foreground text-[15px] font-semibold"
                    style={{ fontFamily: 'Georgia' }}
                >
                    {name}
                </Text>
                <Text
                    className="text-[9px] text-muted-foreground mt-px font-semibold"
                    style={{ letterSpacing: 1.6 }}
                >
                    YOUR DATA, AT HOME
                </Text>
            </View>
        </View>
    )
}

function PrimaryCta({
    label,
    onPress,
    disabled,
    testID,
}: {
    label: string
    onPress: () => void
    disabled?: boolean
    testID?: string
}) {
    const bg = useThemeColor('background')
    return (
        <Pressable
            testID={testID}
            onPress={onPress}
            disabled={disabled}
            className={`bg-foreground rounded-2xl py-4 px-5 items-center justify-center relative overflow-hidden ${disabled ? 'opacity-[0.55]' : 'opacity-100'}`}
        >
            <View className="absolute top-0 bottom-0 left-0 w-1 bg-primary" />
            <View className="flex-row items-center gap-2">
                <Globe size={16} color={bg} />
                <Text className="text-[15px] font-semibold text-background">{label}</Text>
            </View>
        </Pressable>
    )
}

function hostLabel(url: string | undefined): string | null {
    if (!url) return null
    try {
        return new URL(url).host
    } catch {
        return null
    }
}
