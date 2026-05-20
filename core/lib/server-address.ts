import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import { getCoreConfigOptional, registerConfigListener } from './core-config'

const STORAGE_KEY_PREFIX = 'tinycld:server:'

function envToAddress(env: string): string | null {
    const config = getCoreConfigOptional()
    if (!config) return null
    if (env === 'web') {
        const fromConfig = config.webShortcut?.()
        if (fromConfig) return fromConfig
        if (typeof window === 'undefined') return null
        return window.location.origin
    }
    return config.serverShortcuts[env] ?? null
}

export function resolveEnvAddress(): string | null {
    // Web is always same-origin: the page is served from the dev proxy (or
    // production app server) which routes /api and /_ to PB. There's no
    // valid reason to point web fetches at a different origin in any env,
    // so we ignore EXPO_PUBLIC_ENV on web and resolve via window.location.
    if (Platform.OS === 'web') return envToAddress('web')

    const env = process.env.EXPO_PUBLIC_ENV
    if (!env) return null
    return envToAddress(env)
}

function storageKey(): string {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
        return `${STORAGE_KEY_PREFIX}${window.location.origin}`
    }
    return `${STORAGE_KEY_PREFIX}app`
}

export async function readCached(): Promise<string | null> {
    return AsyncStorage.getItem(storageKey())
}

export async function writeCached(address: string): Promise<void> {
    await AsyncStorage.setItem(storageKey(), address)
}

export async function clearCached(): Promise<void> {
    await AsyncStorage.removeItem(storageKey())
}

export function normalizeAddress(input: string): string {
    let addr = input.trim()
    if (!/^https?:\/\//i.test(addr)) addr = `https://${addr}`
    addr = addr.replace(/\/+$/, '')
    return addr
}

export async function probe(address: string, timeoutMs = 5000): Promise<void> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        const res = await fetch(`${address}/api/health`, { signal: controller.signal })
        if (!res.ok) {
            throw new Error(`Server returned HTTP ${res.status}`)
        }
    } finally {
        clearTimeout(timer)
    }
}

let resolvedAddress: string | null = null
const listeners = new Set<() => void>()

export function setResolvedAddress(address: string | null): void {
    resolvedAddress = address
    for (const listener of listeners) listener()
}

export function getResolvedAddress(): string | null {
    return resolvedAddress
}

export function subscribeResolvedAddress(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

function applyEnvAddress(): void {
    const envAddr = resolveEnvAddress()
    if (envAddr) setResolvedAddress(envAddr)
}

applyEnvAddress()

// Re-resolve once the app calls configureCore — the first pass above runs
// at module load, when config may not be registered yet.
registerConfigListener(applyEnvAddress)
