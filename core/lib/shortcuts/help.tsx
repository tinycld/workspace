import { create } from '@tinycld/core/lib/store'
import { Kbd } from '@tinycld/core/ui/Kbd'
import { Modal, ModalBackdrop, ModalContent } from '@tinycld/core/ui/modal'
import { useMemo } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { useShortcutRegistry } from './registry'
import type { Shortcut } from './types'

interface HelpState {
    isOpen: boolean
    open: () => void
    close: () => void
    toggle: () => void
}

export const useShortcutHelpStore = create<HelpState>(set => ({
    isOpen: false,
    open: () => set({ isOpen: true }),
    close: () => set({ isOpen: false }),
    toggle: () => set(s => ({ isOpen: !s.isOpen })),
}))

export function useShortcutHelp() {
    return useShortcutHelpStore()
}

function groupShortcuts(map: Map<string, Shortcut>): Record<string, Shortcut[]> {
    const groups: Record<string, Shortcut[]> = {}
    for (const s of map.values()) {
        // The "Help" group documents how to open/close this very overlay, so
        // showing it inside the overlay is redundant.
        if (s.group === 'Help') continue
        const key = s.group ?? 'General'
        if (!groups[key]) groups[key] = []
        groups[key].push(s)
    }
    for (const key of Object.keys(groups)) {
        groups[key].sort((a, b) => a.description.localeCompare(b.description))
    }
    return groups
}

export function ShortcutHelp() {
    const { isOpen, close } = useShortcutHelp()
    const shortcuts = useShortcutRegistry(s => s.shortcuts)
    const grouped = useMemo(() => groupShortcuts(shortcuts), [shortcuts])
    const groupNames = Object.keys(grouped).sort()

    if (!isOpen) return null

    return (
        <Modal isOpen={isOpen} onClose={close} size="lg">
            <ModalBackdrop />
            <ModalContent>
                <View className="pb-3 mb-3 border-b border-border">
                    <Text className="text-lg font-semibold text-foreground">
                        Keyboard shortcuts
                    </Text>
                </View>
                <ScrollView className="max-h-[480px]">
                    {groupNames.map(name => (
                        <HelpGroup key={name} name={name} shortcuts={grouped[name]} />
                    ))}
                </ScrollView>
            </ModalContent>
        </Modal>
    )
}

function HelpGroup({ name, shortcuts }: { name: string; shortcuts: Shortcut[] }) {
    return (
        <View className="mb-4">
            <Text className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                {name}
            </Text>
            {shortcuts.map(s => (
                <View
                    key={s.id}
                    className="flex-row items-center justify-between py-1.5 border-b border-border/30"
                >
                    <Text className="text-sm text-foreground">{s.description}</Text>
                    <Kbd keys={s.keys} />
                </View>
            ))}
        </View>
    )
}
