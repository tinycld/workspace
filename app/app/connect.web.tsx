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
import { ChevronDown, Globe, Server } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'

const FALLBACK_DEFAULT_SERVER = 'https://tinycld.org'

const urlSchema = z.object({
    url: z.string().min(1, 'Enter a server address.'),
})

export default function ConnectWeb() {
    const { backTo } = useLocalSearchParams<{ backTo?: string }>()
    const config = getCoreConfigOptional()
    const brandName = config?.brandName ?? 'TinyCld'
    const defaultServer = config?.defaultServer ?? FALLBACK_DEFAULT_SERVER
    const defaultServerLabel = hostLabel(defaultServer) ?? 'tinycld.org'

    const [expanded, setExpanded] = useState(false)
    const [busyDefault, setBusyDefault] = useState(false)
    const [busyCustom, setBusyCustom] = useState(false)
    const [submitError, setSubmitError] = useState<string | null>(null)

    const fg = useThemeColor('foreground')
    const bg = useThemeColor('background')
    const muted = useThemeColor('muted-foreground')

    const { control, handleSubmit } = useForm({
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
        <ScrollView
            className="flex-1 bg-background"
            contentContainerStyle={{
                flexGrow: 1,
                alignItems: 'center',
                justifyContent: 'center',
                padding: 32,
            }}
        >
            <View
                className="w-full rounded-[20px] bg-surface border border-border overflow-hidden flex-row flex-wrap"
                style={{ maxWidth: 880 }}
            >
                <View
                    className="flex-1 p-10 bg-surface-secondary border-r border-border relative"
                    style={{ minWidth: 320 }}
                >
                    <View className="absolute top-0 bottom-0 left-0 w-[3px] bg-primary" />

                    <BrandMark name={brandName} />

                    <View className="flex-row items-center gap-2 mt-7 mb-2.5">
                        <View className="w-[18px] h-px bg-primary" />
                        <Text
                            className="text-[11px] font-semibold text-primary"
                            style={{ letterSpacing: 2 }}
                        >
                            WELCOME
                        </Text>
                    </View>

                    <Text
                        className="text-foreground text-4xl font-semibold"
                        style={{
                            lineHeight: 40,
                            letterSpacing: -1,
                            fontFamily: 'Georgia',
                        }}
                    >
                        Pick where your{' '}
                        <Text
                            className="italic font-normal text-primary"
                            style={{ fontFamily: 'Georgia' }}
                        >
                            stuff
                        </Text>{' '}
                        lives.
                    </Text>

                    <Text
                        className="text-foreground text-[15px] mt-4"
                        style={{
                            lineHeight: 24,
                            opacity: 0.78,
                            maxWidth: 380,
                        }}
                    >
                        {brandName} is a personal cloud — mail, calendar, files, contacts — all kept
                        on a server you choose. Use ours, or run your own. Either way, your data
                        stays on the box you point to.
                    </Text>

                    <View className="flex-1" />

                    <View className="mt-8">
                        <ConnectIllustration height={130} />
                    </View>
                </View>

                <View className="flex-1 p-10 gap-4" style={{ minWidth: 320 }}>
                    <Pressable
                        testID="connect-use-default"
                        onPress={onUseDefault}
                        disabled={busy}
                        className={`border-[1.5px] border-foreground bg-foreground rounded-2xl p-[18px] flex-row items-start gap-3.5 ${busy ? 'opacity-60' : 'opacity-100'}`}
                    >
                        <View
                            className="w-9 h-9 rounded-[10px] items-center justify-center"
                            style={{ backgroundColor: 'rgba(255,255,255,0.12)' }}
                        >
                            <Globe size={18} color={bg} />
                        </View>
                        <View className="flex-1">
                            <Text
                                className="text-background text-[15px] font-semibold"
                                style={{ letterSpacing: -0.2 }}
                            >
                                {busyDefault ? 'Connecting…' : `Use ${defaultServerLabel}`}
                            </Text>
                            <Text className="text-background opacity-70 text-[13px] leading-[19px] mt-[3px]">
                                Hosted by us. Free to start — fully encrypted, fully yours, no setup
                                required.
                            </Text>
                        </View>
                    </Pressable>

                    <View className="flex-row items-center gap-3">
                        <View className="flex-1 h-px bg-border" />
                        <Text
                            className="text-[11px] text-muted-foreground font-semibold"
                            style={{ letterSpacing: 2 }}
                        >
                            OR
                        </Text>
                        <View className="flex-1 h-px bg-border" />
                    </View>

                    <View className="border-[1.5px] border-border rounded-2xl bg-surface overflow-hidden">
                        <Pressable
                            onPress={() => setExpanded(open => !open)}
                            disabled={busy}
                            className="p-[18px] flex-row items-start gap-3.5"
                        >
                            <View className="w-9 h-9 rounded-[10px] bg-surface-secondary items-center justify-center">
                                <Server size={18} color={fg} />
                            </View>
                            <View className="flex-1">
                                <Text
                                    className="text-foreground text-[15px] font-semibold"
                                    style={{ letterSpacing: -0.2 }}
                                >
                                    I run my own server
                                </Text>
                                <Text className="text-muted-foreground text-[13px] leading-[19px] mt-[3px]">
                                    Self-hosted, on your machine or somewhere you rent.
                                </Text>
                            </View>
                            <View
                                className="mt-2"
                                style={{
                                    transform: [{ rotate: expanded ? '180deg' : '0deg' }],
                                }}
                            >
                                <ChevronDown size={18} color={muted} />
                            </View>
                        </Pressable>

                        {expanded ? (
                            <View className="px-[18px] pb-[18px] border-t border-border pt-4 gap-3">
                                <TextInput
                                    control={control}
                                    name="url"
                                    label="Server address"
                                    placeholder="https://pb.example.com"
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    keyboardType="url"
                                    hint="We'll ping /api/health to make sure it's listening."
                                />

                                {submitError ? (
                                    <View className="rounded-lg p-3 bg-danger-soft">
                                        <Text className="text-xs text-danger">{submitError}</Text>
                                    </View>
                                ) : null}

                                <Pressable
                                    onPress={onSubmitCustom}
                                    disabled={busy}
                                    className={`self-start bg-foreground rounded-[11px] py-[11px] px-[18px] ${busy ? 'opacity-[0.55]' : 'opacity-100'}`}
                                >
                                    <Text className="text-background text-sm font-semibold">
                                        {busyCustom ? 'Connecting…' : 'Connect'}
                                    </Text>
                                </Pressable>
                            </View>
                        ) : null}
                    </View>

                    {submitError && !expanded ? (
                        <View className="rounded-lg p-3 bg-danger-soft">
                            <Text className="text-xs text-danger">{submitError}</Text>
                        </View>
                    ) : null}
                </View>
            </View>
        </ScrollView>
    )
}

function BrandMark({ name }: { name: string }) {
    const initial = name.charAt(0).toUpperCase()
    return (
        <View className="flex-row items-center gap-2.5">
            <View className="w-8 h-8 rounded-[9px] bg-foreground items-center justify-center relative">
                <Text
                    className="text-background text-base font-bold"
                    style={{ fontFamily: 'Georgia' }}
                >
                    {initial}
                </Text>
                <View className="absolute top-1 right-1 w-[5px] h-[5px] rounded-full bg-primary" />
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

function hostLabel(url: string | undefined): string | null {
    if (!url) return null
    try {
        return new URL(url).host
    } catch {
        return null
    }
}
