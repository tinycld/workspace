// TemplatePicker is the modal users see when they click "From template…"
// on the text index screen. It lists every entry in TEXT_TEMPLATES
// (currently four: blank, letter, resume, report) as a card and reports
// the user's pick to onPick — the parent owns the upload kickoff so a
// single mutation instance can back both the "New document" button and
// the picker flow.

import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import {
    Modal,
    ModalBackdrop,
    ModalBody,
    ModalContent,
    ModalHeader,
} from '@tinycld/core/ui/modal'
import { FilePlus2, FileText, Mail, ScrollText, X } from 'lucide-react-native'
import type { ComponentType } from 'react'
import { Pressable, Text, View } from 'react-native'
import { TEXT_TEMPLATES, type TemplateId, type TextTemplate } from '../lib/templates/index'

interface TemplatePickerProps {
    isOpen: boolean
    onClose: () => void
    onPick: (id: TemplateId) => void
    isPending: boolean
}

// Per-template icon. Kept as a flat map (not on TextTemplate itself) so
// the registry can stay free of React-specific imports — that way the
// generator + the unit tests that probe the registry don't pull in
// lucide-react-native, which is RN-only.
const TEMPLATE_ICONS: Record<TemplateId, ComponentType<{ size?: number; color?: string }>> = {
    blank: FileText,
    letter: Mail,
    resume: FilePlus2,
    report: ScrollText,
}

export function TemplatePicker({ isOpen, onClose, onPick, isPending }: TemplatePickerProps) {
    const mutedFg = useThemeColor('muted-foreground')
    return (
        <Modal isOpen={isOpen} onClose={onClose} size="lg">
            <ModalBackdrop />
            <ModalContent>
                <ModalHeader>
                    <Text
                        accessibilityRole="header"
                        aria-level={2}
                        className="text-lg font-semibold text-foreground"
                    >
                        New from template
                    </Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Close"
                        onPress={onClose}
                        className="p-1 rounded hover:bg-surface-secondary"
                    >
                        <X size={18} color={mutedFg} />
                    </Pressable>
                </ModalHeader>
                <ModalBody>
                    <View className="flex-row flex-wrap gap-3 mt-2">
                        {TEXT_TEMPLATES.map(template => (
                            <TemplateCard
                                key={template.id}
                                template={template}
                                isDisabled={isPending}
                                onPick={onPick}
                            />
                        ))}
                    </View>
                </ModalBody>
            </ModalContent>
        </Modal>
    )
}

interface TemplateCardProps {
    template: TextTemplate
    isDisabled: boolean
    onPick: (id: TemplateId) => void
}

function TemplateCard({ template, isDisabled, onPick }: TemplateCardProps) {
    const Icon = TEMPLATE_ICONS[template.id]
    const accentFg = useThemeColor('accent-foreground')
    const accent = useThemeColor('accent')
    const handlePress = () => onPick(template.id)
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Create from template: ${template.name}`}
            onPress={handlePress}
            disabled={isDisabled}
            className="w-[200px] p-4 gap-2 rounded-lg border border-border bg-surface-secondary hover:bg-accent/10 disabled:opacity-50"
        >
            <View
                className="w-10 h-10 rounded-md items-center justify-center"
                style={{ backgroundColor: accent }}
            >
                <Icon size={20} color={accentFg} />
            </View>
            <Text className="text-sm font-semibold text-foreground">{template.name}</Text>
            <Text className="text-xs text-muted-foreground" numberOfLines={3}>
                {template.description}
            </Text>
        </Pressable>
    )
}
