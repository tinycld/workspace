import { openHelp } from '@tinycld/core/lib/help/open-help'
import { type HelpSearchResult, searchHelpTopics } from '@tinycld/core/lib/help/search'
import { useHelpSearchStore } from '@tinycld/core/lib/help/search-store'
import type { HelpTopicId } from '@tinycld/core/lib/help/types'
import { useHelpTopics } from '@tinycld/core/lib/help/use-help-topics'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { type ReactNode, type RefObject, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Pressable, Text, TextInput, View } from 'react-native'

const PALETTE_WIDTH_PX = 560
const PALETTE_TOP_OFFSET_PX = 96

// Inject the open-animation keyframes once at module load. React
// Native's StyleSheet doesn't expose @keyframes, so the alternative
// would be a JS-driven Animated value — but the animation runs once on
// mount and never again, so a tiny static <style> tag is simpler and
// avoids a re-render loop on every open. Guarded for SSR.
if (typeof document !== 'undefined' && !document.getElementById('tinycld-help-palette-styles')) {
    const styleEl = document.createElement('style')
    styleEl.id = 'tinycld-help-palette-styles'
    styleEl.textContent = `@keyframes tinycld-help-palette-in {
        from { opacity: 0; transform: translateY(-4px); }
        to { opacity: 1; transform: translateY(0); }
    }`
    document.head.appendChild(styleEl)
}

// HelpSearchPalette renders the global help command palette. Listens
// to the Zustand store driven by the Cmd+/ keybinding, the menubar
// "Search help…" item, and the toolbar "?" launcher. Web-only: portals
// to document.body so the overlay sits above the editor surface
// without being clipped by the editor's scroll container.
export function HelpSearchPalette() {
    const isOpen = useHelpSearchStore(s => s.isOpen)
    const query = useHelpSearchStore(s => s.query)
    const selectedIndex = useHelpSearchStore(s => s.selectedIndex)
    const setQuery = useHelpSearchStore(s => s.setQuery)
    const setSelectedIndex = useHelpSearchStore(s => s.setSelectedIndex)
    const close = useHelpSearchStore(s => s.close)

    const topics = useHelpTopics()
    const results = useMemo(() => searchHelpTopics(topics, query), [topics, query])

    // Clamp the selected index whenever the result list changes — the
    // user could type a narrower query and shorten the list out from
    // under the highlight.
    const clampedIndex = results.length === 0 ? 0 : Math.min(selectedIndex, results.length - 1)

    const inputRef = useRef<TextInput>(null)

    useEffect(() => {
        if (!isOpen) return
        // Focus the input on open. RN's TextInput needs a microtask
        // before its DOM node is mounted under the portal, so we defer
        // via requestAnimationFrame.
        const raf = requestAnimationFrame(() => {
            inputRef.current?.focus()
        })
        return () => cancelAnimationFrame(raf)
    }, [isOpen])

    // Click-outside dismiss. Anything outside the palette card closes
    // it — matches Spotlight + the slash-menu's pattern.
    useEffect(() => {
        if (!isOpen || typeof document === 'undefined') return
        function onPointerDown(event: MouseEvent) {
            const target = event.target
            if (!(target instanceof Element)) return
            if (target.closest('[data-tinycld-help-palette]')) return
            close()
        }
        document.addEventListener('mousedown', onPointerDown, true)
        return () => document.removeEventListener('mousedown', onPointerDown, true)
    }, [isOpen, close])

    // Keyboard navigation. Bound to document keydown in CAPTURE phase
    // while the palette is open. Capture phase matters because
    // react-native-web's TextInput swallows Escape on its own internal
    // bubble-phase handler — a non-capturing listener never sees it.
    // ArrowUp/ArrowDown likewise need this because TextInput.onKeyPress
    // doesn't fire for non-character keys.
    useEffect(() => {
        if (!isOpen || typeof document === 'undefined') return
        function onKeyDown(event: KeyboardEvent) {
            const key = event.key
            if (key === 'Escape') {
                event.preventDefault()
                close()
                return
            }
            if (key === 'ArrowDown') {
                event.preventDefault()
                if (results.length === 0) return
                setSelectedIndex((clampedIndex + 1) % results.length)
                return
            }
            if (key === 'ArrowUp') {
                event.preventDefault()
                if (results.length === 0) return
                setSelectedIndex((clampedIndex - 1 + results.length) % results.length)
                return
            }
            if (key === 'Enter') {
                event.preventDefault()
                const picked = results[clampedIndex]
                if (picked) {
                    openHelp(picked.topic.id)
                    close()
                }
            }
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => document.removeEventListener('keydown', onKeyDown, true)
    }, [isOpen, results, clampedIndex, close, setSelectedIndex])

    if (!isOpen || typeof document === 'undefined') return null

    return createPortal(
        <PaletteOverlay>
            <PaletteCard>
                <SearchField inputRef={inputRef} value={query} onChange={setQuery} />
                <ResultList
                    results={results}
                    query={query}
                    selectedIndex={clampedIndex}
                    onPick={topicId => {
                        openHelp(topicId)
                        close()
                    }}
                    onHover={i => setSelectedIndex(i)}
                />
                <PaletteFooter />
            </PaletteCard>
        </PaletteOverlay>,
        document.body
    )
}

function PaletteOverlay({ children }: { children: ReactNode }) {
    // Full-viewport fixed layer so the click-outside listener has
    // somewhere to fire. The card itself is positioned within.
    return (
        <View
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                alignItems: 'center',
                paddingTop: PALETTE_TOP_OFFSET_PX,
                zIndex: 1000,
            } as object}
            pointerEvents="box-none"
        >
            {children}
        </View>
    )
}

function PaletteCard({ children }: { children: ReactNode }) {
    // animationName drives the open animation defined in the module-
    // level <style> tag. RN ignores CSS animation properties on
    // native, but this component is .web.tsx so we're safe to use
    // browser semantics directly.
    const animationStyle = {
        animationName: 'tinycld-help-palette-in',
        animationDuration: '120ms',
        animationTimingFunction: 'ease-out',
    } as object
    const cardDomProps = {
        'data-tinycld-help-palette': 'true',
        role: 'dialog',
        'aria-label': 'Search help',
    } as object
    return (
        <View
            {...(cardDomProps as Record<string, unknown>)}
            style={{
                width: PALETTE_WIDTH_PX,
                maxWidth: '90%',
                maxHeight: '60vh',
                ...animationStyle,
            } as object}
            className="rounded-xl border border-border bg-background shadow-lg overflow-hidden"
        >
            {children}
        </View>
    )
}

interface SearchFieldProps {
    inputRef: RefObject<TextInput | null>
    value: string
    onChange: (v: string) => void
}

function SearchField({ inputRef, value, onChange }: SearchFieldProps) {
    const placeholderColor = useThemeColor('muted-foreground')
    return (
        <View className="px-4 pt-4 pb-2">
            <TextInput
                ref={inputRef}
                value={value}
                onChangeText={onChange}
                placeholder="Search help topics…"
                placeholderTextColor={placeholderColor}
                className="text-base text-foreground"
                style={{ outlineWidth: 0 } as object}
                accessibilityLabel="Search help"
            />
        </View>
    )
}

interface ResultListProps {
    results: HelpSearchResult[]
    query: string
    selectedIndex: number
    onPick: (topicId: HelpTopicId) => void
    onHover: (index: number) => void
}

function ResultList({ results, query, selectedIndex, onPick, onHover }: ResultListProps) {
    if (results.length === 0) {
        return <EmptyState query={query} />
    }
    return (
        <View style={{ maxHeight: '40vh', overflowY: 'auto' } as object}>
            {results.map((result, index) => (
                <ResultRow
                    key={result.topic.id}
                    title={result.topic.title}
                    summary={result.topic.summary}
                    query={query}
                    isSelected={index === selectedIndex}
                    onPress={() => onPick(result.topic.id)}
                    onHoverIn={() => onHover(index)}
                />
            ))}
        </View>
    )
}

interface ResultRowProps {
    title: string
    summary: string
    query: string
    isSelected: boolean
    onPress: () => void
    onHoverIn: () => void
}

function ResultRow({ title, summary, query, isSelected, onPress, onHoverIn }: ResultRowProps) {
    const optionDomProps = {
        role: 'option',
        'aria-selected': isSelected,
    } as const
    return (
        <Pressable
            onPress={onPress}
            onHoverIn={onHoverIn}
            {...optionDomProps}
            className={`px-4 py-3 ${isSelected ? 'bg-surface-secondary' : 'bg-transparent'}`}
        >
            <HighlightedTitle title={title} query={query} />
            <Text className="text-xs text-muted-foreground mt-0.5" numberOfLines={1}>
                {summary}
            </Text>
        </Pressable>
    )
}

interface HighlightedTitleProps {
    title: string
    query: string
}

// Italic accent on the matched substring instead of a colored highlight
// — the affordance is the slant, not a hue. Falls back to a plain title
// when the query doesn't appear inside it (matched on summary only).
function HighlightedTitle({ title, query }: HighlightedTitleProps) {
    const trimmed = query.trim()
    if (!trimmed) {
        return <Text className="text-base font-medium text-foreground">{title}</Text>
    }
    const lower = title.toLowerCase()
    const idx = lower.indexOf(trimmed.toLowerCase())
    if (idx < 0) {
        return <Text className="text-base font-medium text-foreground">{title}</Text>
    }
    const before = title.slice(0, idx)
    const match = title.slice(idx, idx + trimmed.length)
    const after = title.slice(idx + trimmed.length)
    return (
        <Text className="text-base font-medium text-foreground">
            {before}
            <Text className="italic">{match}</Text>
            {after}
        </Text>
    )
}

function EmptyState({ query }: { query: string }) {
    return (
        <View className="px-4 py-8 items-center">
            <Text className="text-sm text-muted-foreground">
                No topics match <Text className="italic">'{query}'</Text>.
            </Text>
        </View>
    )
}

function PaletteFooter() {
    return (
        <View className="flex-row gap-4 px-4 py-2 border-t border-border">
            <FooterHint label="↑↓ Navigate" />
            <FooterHint label="↵ Open" />
            <FooterHint label="Esc Close" />
        </View>
    )
}

function FooterHint({ label }: { label: string }) {
    return <Text className="text-xs text-muted-foreground">{label}</Text>
}
