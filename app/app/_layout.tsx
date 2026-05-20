// polyfill-dom-shim must run before anything that pulls in prosemirror-view
// (tentap → @tiptap/core → @tiptap/pm/view). Something in our Expo SDK 55
// stack now installs a partial `document` on Hermes that breaks
// prosemirror-view's top-level browser sniff. The shim fills the missing
// `documentElement.style` slot. See lib/polyfill-dom-shim.ts for the why.
import '~/lib/polyfill-dom-shim'
// polyfill-crypto MUST run before configure-core: @tanstack/db's collection
// constructor calls crypto.randomUUID() at module init, and Hermes has no
// global crypto.
import '~/lib/polyfill-crypto'
// configure-core MUST be the first import after the polyfill — it calls
// configureCore(appConfig) at module-init time so every other module in the
// static-import graph sees the registered config on its first read.
import '~/lib/configure-core'
import '~/global.css'
import { MinimalProviders } from '@tinycld/core/components/MinimalProviders'
import { NewVersionToast } from '@tinycld/core/components/NewVersionToast'
import { initSentry } from '@tinycld/core/lib/sentry'
import {
    getResolvedAddress,
    readCached,
    resolveEnvAddress,
    setResolvedAddress,
    subscribeResolvedAddress,
} from '@tinycld/core/lib/server-address'
import { useAppUpdates } from '@tinycld/core/lib/use-app-updates'
import { useChunkLoadRecovery } from '@tinycld/core/lib/use-chunk-load-recovery'
import { useVersionCheck } from '@tinycld/core/lib/use-version-check'
import { router, Slot, usePathname } from 'expo-router'
import { type ComponentType, type ReactNode, useEffect, useState } from 'react'
import { Text, View } from 'react-native'

initSentry()

type ProvidersComponent = ComponentType<{ children: ReactNode }>

type GateState =
    | { status: 'resolving' }
    | { status: 'resolved'; Providers: ProvidersComponent }
    | { status: 'unresolved' }
    | { status: 'failed'; error: string }

function useServerAddressGate(pathname: string): GateState {
    const [state, setState] = useState<GateState>(() => {
        const env = resolveEnvAddress()
        if (env) {
            setResolvedAddress(env)
            return { status: 'resolving' }
        }
        return { status: 'resolving' }
    })

    useEffect(() => {
        let cancelled = false

        async function resolve() {
            try {
                if (!getResolvedAddress()) {
                    const cached = await readCached()
                    if (cached) setResolvedAddress(cached)
                }

                if (cancelled) return

                if (getResolvedAddress()) {
                    // Flip out of 'unresolved' synchronously so a navigation
                    // racing the dynamic import below (e.g. /connect doing
                    // setResolvedAddress + router.replace('/')) doesn't trip
                    // the unresolved→/connect redirect effect.
                    setState(prev =>
                        prev.status === 'unresolved' ? { status: 'resolving' } : prev
                    )
                    const mod = await import('@tinycld/core/components/Providers')
                    if (cancelled) return
                    setState({ status: 'resolved', Providers: mod.Providers })
                } else {
                    setState({ status: 'unresolved' })
                }
            } catch (err) {
                // Without this catch a failure inside the dynamic Providers
                // import (e.g. a transitive native module that fails to
                // initialize after a binary/JS mismatch) leaves the gate
                // stuck at "resolving" → permanent blank white screen with
                // nothing in the logs. Surface it so the next layer can show
                // diagnostic UI.
                if (cancelled) return
                const message = err instanceof Error ? err.message : String(err)
                // biome-ignore lint/suspicious/noConsole: pre-Sentry boot path
                console.error('[layout-gate] failed to resolve providers:', err)
                setState({ status: 'failed', error: message })
            }
        }

        resolve()
        const unsubscribe = subscribeResolvedAddress(() => {
            if (cancelled) return
            resolve()
        })
        return () => {
            cancelled = true
            unsubscribe()
        }
    }, [])

    useEffect(() => {
        if (state.status !== 'unresolved') return
        if (pathname === '/connect') return
        const backTo = encodeURIComponent(pathname || '/')
        router.replace(`/connect?backTo=${backTo}`)
    }, [state.status, pathname])

    return state
}

export default function Layout() {
    const pathname = usePathname()
    const state = useServerAddressGate(pathname)
    useVersionCheck()
    useChunkLoadRecovery()
    useAppUpdates()

    if (state.status === 'resolving') {
        return (
            <MinimalProviders>
                <View className="flex-1 bg-background" />
            </MinimalProviders>
        )
    }

    if (state.status === 'failed') {
        return (
            <MinimalProviders>
                <View className="flex-1 items-center justify-center bg-background gap-2 p-6">
                    <Text className="text-foreground" style={{ fontSize: 18, fontWeight: '600' }}>
                        Failed to load app
                    </Text>
                    <Text className="text-muted-foreground text-center">{state.error}</Text>
                </View>
            </MinimalProviders>
        )
    }

    if (state.status === 'unresolved') {
        if (pathname === '/connect') {
            return (
                <MinimalProviders>
                    <Slot />
                </MinimalProviders>
            )
        }
        return (
            <MinimalProviders>
                <View className="flex-1 bg-background" />
            </MinimalProviders>
        )
    }

    const { Providers } = state
    return (
        <Providers>
            <Slot />
            <NewVersionToast />
        </Providers>
    )
}
