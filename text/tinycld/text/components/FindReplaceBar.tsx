import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { ChevronDown, ChevronUp, Replace, ReplaceAll, X } from 'lucide-react-native'
import { useEffect, useRef } from 'react'
import { Platform, Pressable, Text, TextInput, useWindowDimensions, View } from 'react-native'
import { useFindReplaceEditor } from '../lib/find-replace-editor-context'
import { useFindReplaceStore } from '../lib/stores/find-replace-store'
import { useFindReplaceControllerState } from '../lib/use-find-replace-controller-state'

// Overlay bar with two text inputs (find / replace) plus prev / next /
// replace / replace-all / close. Returns null when closed — the
// surrounding find/replace plugin's decoration state is also cleared
// on close (see the second effect below), so leaving the bar mounted
// when invisible buys nothing.
//
// Keyboard plumbing: this component owns the in-bar shortcuts
// (Enter = next, Shift+Enter = prev, Escape = close). The Cmd/Ctrl+F
// global shortcut + Cmd/Ctrl+G / F3 / Shift+F3 cycling shortcuts live
// in useFindReplaceShortcuts below — they're bound at the screen
// level so opening doesn't require focus to already be in the bar.
//
// State + commands all flow through a platform-agnostic
// FindReplaceController — see lib/find-replace-controller.ts for the
// abstraction. The bar doesn't know whether it's driving an in-
// process Tiptap editor (web) or a WebView (native).

interface FindReplaceBarProps {
    isVisible: boolean
}

export function FindReplaceBar({ isVisible }: FindReplaceBarProps) {
    const findQuery = useFindReplaceStore(s => s.findQuery)
    const replaceQuery = useFindReplaceStore(s => s.replaceQuery)
    const setFindQ = useFindReplaceStore(s => s.setFindQuery)
    const setReplaceQ = useFindReplaceStore(s => s.setReplaceQuery)
    const close = useFindReplaceStore(s => s.close)
    const controller = useFindReplaceEditor()
    const controllerState = useFindReplaceControllerState(controller)
    const inputRef = useRef<TextInput>(null)
    const mutedFg = useThemeColor('muted-foreground')
    // At narrow widths (iPhone-mini-class 375pt logical) the original
    // bar's two min-w-[180px] inputs + 5 button row + Replace/Replace-all
    // text labels overflow off-screen. Below the breakpoint we stretch
    // the inputs (flex-1), span the bar across the screen with side
    // margins (right-2 left-2), and switch the Replace buttons from
    // text labels to icons so the row fits.
    const { width } = useWindowDimensions()
    const isCompact = width < 480

    // Refocus the find input every time the bar opens so the user can
    // start typing immediately. Without this the focus stays on the
    // editor surface where it was when Cmd+F fired.
    useEffect(() => {
        if (!isVisible) return
        inputRef.current?.focus()
    }, [isVisible])

    // Push the query string into the controller whenever the user
    // types OR the bar is reopened. We deliberately re-fire on
    // `isVisible` so closing+reopening with the same query reshows the
    // highlights (the plugin's state was reset on close). Skipping the
    // initial "bar was already closed" run avoids a redundant clear
    // transaction during the screen's first paint.
    //
    // Race: if the bar opens before the WebView's bridge installs its
    // message listener, this setQuery message is dropped silently
    // (postMessage returns false on native; web's controller dispatches
    // synchronously and can never miss). No manual retry needed —
    // the next user keystroke retriggers this effect, and the bridge's
    // initial state broadcast catches the host store up as soon as the
    // listener attaches. Commands are idempotent on the WebView side
    // (setQuery is a plugin meta; next/prev no-op without matches), so
    // a dropped first send isn't observable.
    const wasVisibleRef = useRef(false)
    useEffect(() => {
        if (!controller) return
        if (!isVisible) {
            if (wasVisibleRef.current) controller.clear()
            wasVisibleRef.current = false
            return
        }
        wasVisibleRef.current = true
        controller.setQuery(findQuery)
    }, [controller, findQuery, isVisible])

    if (!isVisible) return null

    const matchCount = controllerState?.matchCount ?? 0
    const currentIndex = controllerState?.currentIndex ?? 0
    const matchLabel = matchCount === 0 ? '0/0' : `${currentIndex + 1}/${matchCount}`

    const onFindEnter = (shift: boolean) => {
        if (!controller) return
        if (shift) controller.prev()
        else controller.next()
    }

    const containerClass = isCompact
        ? 'absolute top-2 right-2 left-2 z-50 bg-background border border-border rounded-md p-2 shadow-md'
        : 'absolute top-2 right-2 z-50 bg-background border border-border rounded-md p-2 shadow-md'

    const inputClass = isCompact
        ? 'flex-1 border border-border rounded px-2 py-1 text-sm text-foreground'
        : 'border border-border rounded px-2 py-1 text-sm text-foreground min-w-[180px]'

    const onFindKeyPress =
        Platform.OS === 'web'
            ? (e: { nativeEvent: { key: string; shiftKey?: boolean } }) => {
                  const native = e.nativeEvent
                  if (native.key === 'Enter') {
                      onFindEnter(Boolean(native.shiftKey))
                  } else if (native.key === 'Escape') {
                      close()
                  }
              }
            : undefined

    return (
        <View className={containerClass} accessibilityLabel="Find and replace">
            <View className="gap-2">
                <View className="flex-row items-center gap-2">
                    <TextInput
                        ref={inputRef}
                        value={findQuery}
                        onChangeText={setFindQ}
                        placeholder="Find"
                        placeholderTextColor={mutedFg}
                        className={inputClass}
                        accessibilityLabel="Find"
                        onKeyPress={onFindKeyPress}
                    />
                    <Text className="text-xs text-muted-foreground min-w-[36px]">{matchLabel}</Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Previous match"
                        onPress={() => controller?.prev()}
                        disabled={!controller || matchCount === 0}
                        className="p-1 rounded hover:bg-surface-secondary"
                    >
                        <ChevronUp size={16} color={mutedFg} />
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Next match"
                        onPress={() => controller?.next()}
                        disabled={!controller || matchCount === 0}
                        className="p-1 rounded hover:bg-surface-secondary"
                    >
                        <ChevronDown size={16} color={mutedFg} />
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Close find"
                        onPress={close}
                        className="p-1 rounded hover:bg-surface-secondary"
                    >
                        <X size={16} color={mutedFg} />
                    </Pressable>
                </View>
                <View className="flex-row items-center gap-2">
                    <TextInput
                        value={replaceQuery}
                        onChangeText={setReplaceQ}
                        placeholder="Replace"
                        placeholderTextColor={mutedFg}
                        className={inputClass}
                        accessibilityLabel="Replace"
                    />
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Replace"
                        onPress={() => controller?.replaceCurrent(replaceQuery)}
                        disabled={!controller || matchCount === 0}
                        className={
                            isCompact
                                ? 'p-1 rounded border border-border hover:bg-surface-secondary'
                                : 'px-2 py-1 rounded border border-border hover:bg-surface-secondary'
                        }
                    >
                        {isCompact ? (
                            <Replace size={16} color={mutedFg} />
                        ) : (
                            <Text className="text-xs text-foreground">Replace</Text>
                        )}
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Replace all"
                        onPress={() => controller?.replaceAll(replaceQuery)}
                        disabled={!controller || matchCount === 0}
                        className={
                            isCompact
                                ? 'p-1 rounded border border-border hover:bg-surface-secondary'
                                : 'px-2 py-1 rounded border border-border hover:bg-surface-secondary'
                        }
                    >
                        {isCompact ? (
                            <ReplaceAll size={16} color={mutedFg} />
                        ) : (
                            <Text className="text-xs text-foreground">Replace all</Text>
                        )}
                    </Pressable>
                </View>
            </View>
        </View>
    )
}

// Screen-level keyboard plumbing. Bound on document so the user can
// open the bar from anywhere in the editor area — including while
// caret focus is inside the ProseMirror surface (where a bar-local
// keymap couldn't see the event yet).
export function useFindReplaceShortcuts() {
    const open = useFindReplaceStore(s => s.open)
    const close = useFindReplaceStore(s => s.close)
    const controller = useFindReplaceEditor()

    useEffect(() => {
        if (Platform.OS !== 'web' || typeof document === 'undefined') return
        const onKeyDown = (e: KeyboardEvent) => {
            const mod = e.metaKey || e.ctrlKey
            const key = e.key.toLowerCase()
            if (mod && key === 'f') {
                e.preventDefault()
                open()
                return
            }
            // Cmd+G / Ctrl+G or F3 = next; Shift extends to prev.
            if ((mod && key === 'g') || e.key === 'F3') {
                e.preventDefault()
                if (!controller) return
                if (e.shiftKey) controller.prev()
                else controller.next()
                return
            }
            if (e.key === 'Escape') {
                // Only close if the bar is open AND the active element is
                // either the bar itself or the editor surface. We can't
                // easily distinguish "the user wants to dismiss a modal
                // dialog" from "the user wants to close find/replace"
                // generically, but in practice Escape-while-find-is-open
                // means close the bar.
                if (useFindReplaceStore.getState().isOpen) {
                    close()
                }
            }
        }
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    }, [open, close, controller])
}
