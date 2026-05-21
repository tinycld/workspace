import type { EditorCommands } from '@tinycld/core/lib/editor/types'
import {
    Actionsheet,
    ActionsheetBackdrop,
    ActionsheetContent,
    ActionsheetDragIndicator,
    ActionsheetDragIndicatorWrapper,
} from '@tinycld/core/ui/actionsheet'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { X } from 'lucide-react-native'
import { Platform, Pressable, Text, View } from 'react-native'
import { IMAGE_MAX_WIDTH } from '../lib/image-resize'
import {
    IMAGE_SIZE_PRESETS,
    type ImageSizePreset,
    resolvePresetSize,
} from '../lib/image-size-presets'
import {
    IMAGE_WRAP_MODES,
    normalizeWrap,
    type WrapMode,
    wrapToAttr,
} from '../lib/image-wrap-modes'
import { useImageSelectionStore } from '../lib/stores/image-selection-store'

// ImageAttrsBottomSheet — native-only bottom-sheet that opens whenever
// the WebView's editor selection lands on an image. The web editor has
// a NodeView overlay (ImageNodeView.web.tsx) for the same wrap-mode +
// size operations; on native the WebView renders bare <img>s with no
// place to anchor in-document chrome, so we surface the controls as
// an Actionsheet anchored to the screen bottom.
//
// Flow:
//   - WebView's Editor.tsx broadcasts ui.selection-changed whenever
//     the selection enters / leaves / changes an image.
//   - useDocumentEditor.native.tsx writes the payload into
//     useImageSelectionStore.
//   - This sheet subscribes via Zustand selectors and renders when
//     `selection` is non-null.
//   - User taps a wrap chip / size preset → commands.updateImageAttrs?.
//     posts a format.update-image-attrs message back into the
//     WebView, which dispatches editor.updateAttributes('image', ...).
//
// Web platform: returns null. The path is gated on Platform.OS first
// so importing this component from a shared screen costs almost
// nothing on the web build.

interface ImageAttrsBottomSheetProps {
    editable: boolean
    commands: EditorCommands
}

// Wrap-mode chip labels. The WrapMode values themselves are stable
// across web/native (single source of truth in lib/image-wrap-modes);
// these labels are user-facing copy, not part of the persisted set.
const WRAP_LABELS: Record<WrapMode, string> = {
    inline: 'Inline',
    left: 'Wrap left',
    right: 'Wrap right',
    break: 'Break',
}

// Hide on web (the NodeView handles this). Doing the platform check
// before any hook calls keeps the per-render cost on web a single
// comparison; the consumer can mount the component unconditionally.
export function ImageAttrsBottomSheet({ editable, commands }: ImageAttrsBottomSheetProps) {
    if (Platform.OS === 'web') return null
    if (!editable) return null
    return <NativeImageAttrsBottomSheet commands={commands} />
}

function NativeImageAttrsBottomSheet({ commands }: { commands: EditorCommands }) {
    const selection = useImageSelectionStore(s => s.selection)
    const clearSelection = useImageSelectionStore(s => s.clearSelection)
    const isOpen = selection !== null

    if (!isOpen || !selection) return null

    const activeMode = normalizeWrap(selection.wrap)
    const sizeAvailable = selection.naturalWidth > 0 && selection.naturalHeight > 0

    function onWrapPress(mode: WrapMode) {
        commands.updateImageAttrs?.({ wrap: wrapToAttr(mode) })
    }

    function onSizePress(preset: ImageSizePreset) {
        if (!selection) return
        const next = resolvePresetSize(preset, selection.naturalWidth, selection.naturalHeight)
        if (!next) return
        commands.updateImageAttrs?.(next)
    }

    return (
        <Actionsheet isOpen={isOpen} onClose={clearSelection}>
            <ActionsheetBackdrop />
            <ActionsheetContent>
                <ActionsheetDragIndicatorWrapper>
                    <ActionsheetDragIndicator />
                </ActionsheetDragIndicatorWrapper>
                <View className="w-full gap-4 px-2 py-3">
                    <Header onClose={clearSelection} />
                    <Section label="Wrap">
                        <View className="flex-row flex-wrap gap-2">
                            {IMAGE_WRAP_MODES.map(mode => (
                                <WrapChip
                                    key={mode}
                                    label={WRAP_LABELS[mode]}
                                    isActive={mode === activeMode}
                                    onPress={() => onWrapPress(mode)}
                                />
                            ))}
                        </View>
                    </Section>
                    <Section
                        label="Size"
                        hint={
                            sizeAvailable
                                ? `Max width ${IMAGE_MAX_WIDTH}px`
                                : 'Loading image…'
                        }
                    >
                        <View className="flex-row flex-wrap gap-2">
                            {IMAGE_SIZE_PRESETS.map(preset => (
                                <SizeChip
                                    key={preset.id}
                                    label={preset.label}
                                    disabled={!sizeAvailable}
                                    onPress={() => onSizePress(preset)}
                                />
                            ))}
                        </View>
                    </Section>
                </View>
            </ActionsheetContent>
        </Actionsheet>
    )
}

function Header({ onClose }: { onClose: () => void }) {
    const mutedColor = useThemeColor('muted-foreground')
    return (
        <View className="flex-row items-center justify-between">
            <Text className="text-base font-semibold text-foreground">Image</Text>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close image options"
                onPress={onClose}
                hitSlop={8}
                className="p-1 rounded-md"
            >
                <X size={20} color={mutedColor} />
            </Pressable>
        </View>
    )
}

interface SectionProps {
    label: string
    hint?: string
    children: React.ReactNode
}

function Section({ label, hint, children }: SectionProps) {
    const hintNode = hint ? (
        <Text className="text-xs text-muted-foreground">{hint}</Text>
    ) : null
    return (
        <View className="gap-2">
            <View className="flex-row items-center justify-between">
                <Text className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {label}
                </Text>
                {hintNode}
            </View>
            {children}
        </View>
    )
}

interface ChipProps {
    label: string
    isActive?: boolean
    disabled?: boolean
    onPress: () => void
}

// Wrap chip: highlighted when its mode matches the image's current
// wrap attr. Active styling mirrors the BorderMenu's StyleChip pattern
// (bg-accent + accent-foreground text) so the visual language stays
// consistent with the rest of the package's mobile menus.
function WrapChip({ label, isActive, onPress }: ChipProps) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Set wrap to ${label}`}
            accessibilityState={{ selected: isActive }}
            onPress={onPress}
            className={`flex-1 min-w-[80px] items-center px-3 py-2.5 rounded-md border ${
                isActive
                    ? 'border-accent bg-accent'
                    : 'border-border bg-background'
            }`}
        >
            <Text
                className={`text-sm ${
                    isActive ? 'text-accent-foreground font-semibold' : 'text-foreground'
                }`}
            >
                {label}
            </Text>
        </Pressable>
    )
}

// Size chip: never highlighted (each tap is a one-shot resize, not a
// toggle). disabled=true when the image's natural dimensions aren't
// known yet — at that point any preset would round to {0, 0} and the
// in-WebView guard would silently drop it.
function SizeChip({ label, disabled, onPress }: ChipProps) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Resize to ${label}`}
            accessibilityState={{ disabled: Boolean(disabled) }}
            disabled={disabled}
            onPress={onPress}
            className={`flex-1 min-w-[60px] items-center px-3 py-2.5 rounded-md border border-border ${
                disabled ? 'opacity-40' : 'bg-background'
            }`}
        >
            <Text className="text-sm text-foreground">{label}</Text>
        </Pressable>
    )
}
