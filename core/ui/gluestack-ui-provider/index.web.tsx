'use client'
import { OverlayProvider } from '@gluestack-ui/core/overlay/creator'
import { ToastProvider } from '@gluestack-ui/core/toast/creator'
import React, { useEffect, useLayoutEffect } from 'react'
import { Uniwind } from 'uniwind'
import { script } from './script'

export type ModeType = 'light' | 'dark' | 'system'

const useSafeLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

export function GluestackUIProvider({
    mode = 'dark',
    colorTheme,
    ...props
}: {
    mode?: ModeType
    colorTheme?: string
    children?: React.ReactNode
}) {
    const handleMediaQuery = React.useCallback(
        (e: MediaQueryListEvent) => {
            const resolvedMode = e.matches ? 'dark' : 'light'
            script(resolvedMode, colorTheme)
            Uniwind.setTheme(resolvedMode)
        },
        [colorTheme]
    )

    useSafeLayoutEffect(() => {
        if (mode === 'system') return
        script(mode, colorTheme)
        Uniwind.setTheme(mode)
    }, [mode, colorTheme])

    useSafeLayoutEffect(() => {
        if (mode !== 'system') return
        const media = window.matchMedia('(prefers-color-scheme: dark)')
        media.addListener(handleMediaQuery)
        return () => media.removeListener(handleMediaQuery)
    }, [handleMediaQuery, mode])

    return (
        <>
            <script
                suppressHydrationWarning
                dangerouslySetInnerHTML={{
                    __html: `(${script.toString()})('${mode}','${colorTheme ?? ''}')`,
                }}
            />
            <OverlayProvider>
                <ToastProvider>{props.children}</ToastProvider>
            </OverlayProvider>
        </>
    )
}
