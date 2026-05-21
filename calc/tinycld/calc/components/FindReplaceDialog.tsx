import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { ChevronDown, ChevronUp, X } from 'lucide-react-native'
import { useCallback, useMemo } from 'react'
import { Platform, Pressable, Text, TextInput, View } from 'react-native'
import type { FindActions } from '../hooks/find/use-find-actions'
import { useFindStore } from '../hooks/find/use-find-store-context'

interface FindReplaceDialogProps {
    actions: FindActions
}

// Floating panel pinned to the top-right of the grid viewport. Only
// mounted while the find store's isOpen is true — see
// FindReplaceDialogGate at the bottom of this file. All state —
// query, replacement, options, mode — is read directly from the find
// store via useFindStore selectors.
export function FindReplaceDialog({ actions }: FindReplaceDialogProps) {
    const fg = useThemeColor('foreground')
    const muted = useThemeColor('muted-foreground')
    const danger = useThemeColor('danger')

    const mode = useFindStore(s => s.mode)
    const query = useFindStore(s => s.query)
    const replacement = useFindStore(s => s.replacement)
    const matchCase = useFindStore(s => s.matchCase)
    const wholeCell = useFindStore(s => s.wholeCell)
    const useRegex = useFindStore(s => s.useRegex)
    const searchInFormulas = useFindStore(s => s.searchInFormulas)
    const scope = useFindStore(s => s.scope)
    const matchesLength = useFindStore(s => s.matches.length)
    const currentIndex = useFindStore(s => s.currentMatchIndex)
    const regexError = useFindStore(s => s.regexError)
    const setQuery = useFindStore(s => s.setQuery)
    const setReplacement = useFindStore(s => s.setReplacement)
    const setMatchCase = useFindStore(s => s.setMatchCase)
    const setWholeCell = useFindStore(s => s.setWholeCell)
    const setUseRegex = useFindStore(s => s.setUseRegex)
    const setSearchInFormulas = useFindStore(s => s.setSearchInFormulas)
    const setScope = useFindStore(s => s.setScope)
    const setMode = useFindStore(s => s.setMode)

    const counter = useMemo(() => {
        if (matchesLength === 0) return query === '' ? '' : '0 results'
        return `${currentIndex + 1} of ${matchesLength}`
    }, [matchesLength, currentIndex, query])

    const onQueryKey = useCallback(
        (e: { nativeEvent: { key: string } }) => {
            const key = e.nativeEvent.key
            if (key === 'Enter') {
                if (mode === 'replace') {
                    actions.replaceCurrent()
                } else {
                    actions.nextMatch()
                }
            } else if (key === 'Escape') {
                actions.close()
            }
        },
        [actions, mode]
    )

    const toggleMode = useCallback(
        () => setMode(mode === 'find' ? 'replace' : 'find'),
        [mode, setMode]
    )

    return (
        <View
            style={{
                position: 'absolute',
                top: 8,
                right: 8,
                width: 320,
                zIndex: 100,
                ...(Platform.OS === 'web'
                    ? ({ boxShadow: '0 4px 12px rgba(0,0,0,0.15)' } as object)
                    : null),
            }}
            className="rounded border border-border bg-background"
        >
            <View className="flex-row items-center justify-between px-2 py-1 border-b border-border">
                <Text style={{ color: fg, fontSize: 12, fontWeight: '600' }}>
                    {mode === 'replace' ? 'Find and replace' : 'Find'}
                </Text>
                <View className="flex-row items-center" style={{ gap: 4 }}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={
                            mode === 'find' ? 'Switch to Replace' : 'Switch to Find'
                        }
                        onPress={toggleMode}
                        hitSlop={Platform.OS === 'web' ? undefined : { top: 6, bottom: 6, left: 4, right: 4 }}
                        className="rounded px-1"
                    >
                        <Text style={{ color: muted, fontSize: 11 }}>
                            {mode === 'find' ? 'Switch to Replace' : 'Switch to Find'}
                        </Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Close find"
                        onPress={actions.close}
                        hitSlop={Platform.OS === 'web' ? undefined : { top: 6, bottom: 6, left: 4, right: 4 }}
                        className="rounded items-center justify-center"
                        style={{ width: 20, height: 20 }}
                    >
                        <X size={14} color={fg} />
                    </Pressable>
                </View>
            </View>

            <View className="px-2 py-2" style={{ gap: 6 }}>
                <View className="flex-row items-center" style={{ gap: 4 }}>
                    <TextInput
                        accessibilityLabel="Find query"
                        placeholder="Find"
                        value={query}
                        onChangeText={setQuery}
                        onKeyPress={onQueryKey}
                        autoFocus
                        className="flex-1 rounded border border-border bg-surface-secondary px-2"
                        style={{ height: 24, color: fg, fontSize: 12 }}
                        placeholderTextColor={muted}
                    />
                    <Text
                        accessibilityLabel="Find match counter"
                        style={{ color: muted, fontSize: 11, minWidth: 56, textAlign: 'right' }}
                    >
                        {counter}
                    </Text>
                </View>

                {mode === 'replace' ? (
                    <TextInput
                        accessibilityLabel="Replace value"
                        placeholder="Replace with"
                        value={replacement}
                        onChangeText={setReplacement}
                        className="rounded border border-border bg-surface-secondary px-2"
                        style={{ height: 24, color: fg, fontSize: 12 }}
                        placeholderTextColor={muted}
                    />
                ) : null}

                {regexError != null ? (
                    <Text style={{ color: danger, fontSize: 11 }}>
                        Invalid regex: {regexError}
                    </Text>
                ) : null}

                <View className="flex-row items-center" style={{ gap: 4 }}>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Previous match"
                        onPress={actions.prevMatch}
                        hitSlop={Platform.OS === 'web' ? undefined : { top: 6, bottom: 6, left: 4, right: 4 }}
                        className="rounded border border-border items-center justify-center"
                        style={{ width: 24, height: 22 }}
                    >
                        <ChevronUp size={14} color={fg} />
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Next match"
                        onPress={actions.nextMatch}
                        hitSlop={Platform.OS === 'web' ? undefined : { top: 6, bottom: 6, left: 4, right: 4 }}
                        className="rounded border border-border items-center justify-center"
                        style={{ width: 24, height: 22 }}
                    >
                        <ChevronDown size={14} color={fg} />
                    </Pressable>
                    {mode === 'replace' ? (
                        <>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Replace"
                                onPress={actions.replaceCurrent}
                                hitSlop={Platform.OS === 'web' ? undefined : { top: 6, bottom: 6, left: 4, right: 4 }}
                                className="rounded border border-border px-2 items-center justify-center"
                                style={{ height: 22 }}
                            >
                                <Text style={{ color: fg, fontSize: 11 }}>Replace</Text>
                            </Pressable>
                            <Pressable
                                accessibilityRole="button"
                                accessibilityLabel="Replace all"
                                onPress={actions.replaceAll}
                                hitSlop={Platform.OS === 'web' ? undefined : { top: 6, bottom: 6, left: 4, right: 4 }}
                                className="rounded border border-border px-2 items-center justify-center"
                                style={{ height: 22 }}
                            >
                                <Text style={{ color: fg, fontSize: 11 }}>Replace all</Text>
                            </Pressable>
                        </>
                    ) : null}
                </View>

                <View className="flex-row flex-wrap" style={{ gap: 6 }}>
                    <OptionToggle
                        label="Match case"
                        value={matchCase}
                        onChange={setMatchCase}
                    />
                    <OptionToggle
                        label="Whole cell"
                        value={wholeCell}
                        onChange={setWholeCell}
                    />
                    <OptionToggle label="Regex" value={useRegex} onChange={setUseRegex} />
                    <OptionToggle
                        label="In formulas"
                        value={searchInFormulas}
                        onChange={setSearchInFormulas}
                    />
                    <OptionToggle
                        label="All sheets"
                        value={scope === 'workbook'}
                        onChange={v => setScope(v ? 'workbook' : 'sheet')}
                    />
                </View>
            </View>
        </View>
    )
}

interface OptionToggleProps {
    label: string
    value: boolean
    onChange: (v: boolean) => void
}

function OptionToggle({ label, value, onChange }: OptionToggleProps) {
    const fg = useThemeColor('foreground')
    return (
        <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel={label}
            accessibilityState={{ checked: value }}
            onPress={() => onChange(!value)}
            hitSlop={Platform.OS === 'web' ? undefined : { top: 6, bottom: 6, left: 4, right: 4 }}
            className={`rounded border border-border px-2 ${value ? 'bg-accent' : ''}`}
            style={{ height: 20, justifyContent: 'center' }}
        >
            <Text style={{ color: fg, fontSize: 11 }}>{label}</Text>
        </Pressable>
    )
}

interface FindReplaceDialogGateProps {
    actions: FindActions
}

// Mounts FindReplaceDialog only while the find store's isOpen flips
// true. Subscribing here (rather than in Grid) keeps the open/close
// re-render scoped to this gate so the rest of GridInner doesn't
// re-run on every keystroke into the dialog.
export function FindReplaceDialogGate({ actions }: FindReplaceDialogGateProps) {
    const isOpen = useFindStore(s => s.isOpen)
    if (!isOpen) return null
    return <FindReplaceDialog actions={actions} />
}
