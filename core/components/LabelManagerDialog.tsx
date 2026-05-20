import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { COLOR_PALETTE, ColorPickerGrid } from '@tinycld/core/ui/color-picker'
import { Divider } from '@tinycld/core/ui/divider'
import { useForm, z, zodResolver } from '@tinycld/core/ui/form'
import { useLabelMutations } from '@tinycld/core/ui/hooks/useLabelMutations'
import { useLabels } from '@tinycld/core/ui/hooks/useLabels'
import { Modal, ModalBackdrop, ModalContent } from '@tinycld/core/ui/modal'
import { Check, Plus, Trash2, X } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'

const labelSchema = z.object({
    name: z.string().min(1, 'Name is required').max(50, 'Name must be 50 characters or fewer'),
    color: z.string().min(1, 'Pick a color'),
})

// Default new-label color: Cornflower Blue. Picked from the shared
// COLOR_PALETTE rather than the deleted LABEL_COLORS[0] (which was
// red — too alarming as a first-impression default).
const DEFAULT_LABEL_COLOR =
    COLOR_PALETTE.find(s => s.hex === '#4A86E8')?.hex ?? COLOR_PALETTE[0].hex

function LabelRow({
    label,
    isEditing,
    onStartEdit,
    onCancelEdit,
    isConfirmingDelete,
    onStartDelete,
    onCancelDelete,
}: {
    label: { id: string; name: string; color: string }
    isEditing: boolean
    onStartEdit: () => void
    onCancelEdit: () => void
    isConfirmingDelete: boolean
    onStartDelete: () => void
    onCancelDelete: () => void
}) {
    const accentColor = useThemeColor('primary')
    const mutedColor = useThemeColor('muted-foreground')
    const { updateLabel, deleteLabel } = useLabelMutations()

    const { setValue, watch, handleSubmit } = useForm({
        resolver: zodResolver(labelSchema),
        mode: 'onChange',
        defaultValues: { name: label.name, color: label.color },
    })

    const editName = watch('name')
    const editColor = watch('color')

    const onSave = handleSubmit(data => {
        updateLabel.mutate({ id: label.id, ...data }, { onSuccess: onCancelEdit })
    })

    const handleDelete = () => {
        deleteLabel.mutate(label.id)
    }

    const handleStartEdit = () => {
        setValue('name', label.name)
        setValue('color', label.color)
        onStartEdit()
    }

    if (isEditing) {
        return (
            <View className="bg-surface-secondary">
                <View className="flex-row items-center px-3 py-2 gap-2">
                    <View
                        className="w-3.5 h-3.5 rounded-full"
                        style={{ backgroundColor: editColor }}
                    />
                    <TextInput
                        className="flex-1 text-sm p-2 border border-border rounded-md bg-background text-foreground"
                        value={editName}
                        onChangeText={v => setValue('name', v)}
                        placeholder="Label name"
                        autoFocus
                        onSubmitEditing={() => onSave()}
                    />
                    <Pressable onPress={onSave} className="p-1.5" disabled={updateLabel.isPending}>
                        <Check size={16} color={accentColor} />
                    </Pressable>
                    <Pressable onPress={onCancelEdit} className="p-1.5">
                        <X size={16} color={mutedColor} />
                    </Pressable>
                </View>
                <View className="px-1 pb-2">
                    <ColorPickerGrid selected={editColor} onSelect={c => setValue('color', c)} />
                </View>
            </View>
        )
    }

    if (isConfirmingDelete) {
        return (
            <View className="flex-row items-center px-3 py-2 gap-2">
                <View
                    className="w-3.5 h-3.5 rounded-full"
                    style={{ backgroundColor: label.color }}
                />
                <Text numberOfLines={1} className="flex-1 text-sm text-danger">
                    Delete "{label.name}"?
                </Text>
                <Pressable
                    onPress={handleDelete}
                    disabled={deleteLabel.isPending}
                    className="px-2.5 py-1 rounded bg-danger"
                >
                    <Text className="text-xs text-danger-foreground">
                        {deleteLabel.isPending ? 'Deleting' : 'Delete'}
                    </Text>
                </Pressable>
                <Pressable onPress={onCancelDelete} className="px-2 py-1">
                    <Text className="text-xs text-foreground">Cancel</Text>
                </Pressable>
            </View>
        )
    }

    return (
        <Pressable onPress={handleStartEdit}>
            <View className="flex-row items-center px-3 py-2 gap-2.5">
                <View
                    className="w-3.5 h-3.5 rounded-full"
                    style={{ backgroundColor: label.color }}
                />
                <Text numberOfLines={1} className="flex-1 text-sm text-foreground">
                    {label.name}
                </Text>
                <Pressable
                    onPress={e => {
                        e.stopPropagation()
                        onStartDelete()
                    }}
                    className="p-1.5"
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                    <Trash2 size={14} color={mutedColor} />
                </Pressable>
            </View>
        </Pressable>
    )
}

function CreateLabelRow({ onCreated }: { onCreated: () => void }) {
    const accentColor = useThemeColor('primary')
    const mutedColor = useThemeColor('muted-foreground')
    const { createLabel } = useLabelMutations()
    const [isCreating, setIsCreating] = useState(false)

    const { setValue, watch, handleSubmit, reset } = useForm({
        resolver: zodResolver(labelSchema),
        mode: 'onChange',
        defaultValues: { name: '', color: DEFAULT_LABEL_COLOR },
    })

    const name = watch('name')
    const color = watch('color')

    const handleCreate = handleSubmit(data => {
        createLabel.mutate(data, {
            onSuccess: () => {
                reset()
                setIsCreating(false)
                onCreated()
            },
        })
    })

    const handleCancel = () => {
        reset()
        setIsCreating(false)
    }

    if (!isCreating) {
        return (
            <Pressable onPress={() => setIsCreating(true)}>
                <View className="flex-row items-center px-3 py-2 gap-2 opacity-60">
                    <View
                        style={{
                            width: 14,
                            height: 14,
                            borderRadius: 7,
                            borderWidth: 1.5,
                            borderColor: 'rgba(128, 128, 128, 0.4)',
                            borderStyle: 'dashed',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <Plus size={10} color={mutedColor} />
                    </View>
                    <Text className="text-sm text-muted">New label...</Text>
                </View>
            </Pressable>
        )
    }

    return (
        <View className="bg-surface-secondary">
            <View className="flex-row items-center px-3 py-2 gap-2">
                <View className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: color }} />
                <TextInput
                    className="flex-1 text-sm p-2 border border-border rounded-md bg-background text-foreground"
                    value={name}
                    onChangeText={v => setValue('name', v)}
                    placeholder="Label name"
                    autoFocus
                    onSubmitEditing={() => handleCreate()}
                />
                <Pressable
                    onPress={handleCreate}
                    className="p-1.5"
                    disabled={createLabel.isPending}
                >
                    <Check size={16} color={accentColor} />
                </Pressable>
                <Pressable onPress={handleCancel} className="p-1.5">
                    <X size={16} color={mutedColor} />
                </Pressable>
            </View>
            <View className="px-1 pb-2">
                <ColorPickerGrid selected={color} onSelect={c => setValue('color', c)} />
            </View>
        </View>
    )
}

export function LabelManagerPanel({ maxListHeight }: { maxListHeight?: number }) {
    const { labels } = useLabels()
    const [editingLabelId, setEditingLabelId] = useState<string | null>(null)
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

    return (
        <View>
            <View style={{ maxHeight: maxListHeight }}>
                <ScrollView>
                    {labels.length === 0 ? (
                        <View className="py-3 items-center">
                            <Text className="text-xs text-muted">
                                No labels yet — create one below
                            </Text>
                        </View>
                    ) : (
                        labels.map(label => (
                            <LabelRow
                                key={label.id}
                                label={label}
                                isEditing={editingLabelId === label.id}
                                onStartEdit={() => {
                                    setEditingLabelId(label.id)
                                    setConfirmDeleteId(null)
                                }}
                                onCancelEdit={() => setEditingLabelId(null)}
                                isConfirmingDelete={confirmDeleteId === label.id}
                                onStartDelete={() => {
                                    setConfirmDeleteId(label.id)
                                    setEditingLabelId(null)
                                }}
                                onCancelDelete={() => setConfirmDeleteId(null)}
                            />
                        ))
                    )}
                </ScrollView>
            </View>

            <Divider />

            <CreateLabelRow
                onCreated={() => {
                    setEditingLabelId(null)
                    setConfirmDeleteId(null)
                }}
            />
        </View>
    )
}

interface LabelManagerDialogProps {
    isVisible: boolean
    onClose: () => void
}

export function LabelManagerDialog({ isVisible, onClose }: LabelManagerDialogProps) {
    const mutedColor = useThemeColor('muted-foreground')

    return (
        <Modal isOpen={isVisible} onClose={onClose}>
            <ModalBackdrop />
            <ModalContent className="w-[360px] max-h-[480px] p-0 rounded-xl">
                <View className="flex-row items-center justify-between px-3 py-2.5">
                    <Text className="text-lg font-semibold text-foreground">Labels</Text>
                    <Pressable onPress={onClose} className="p-1">
                        <X size={18} color={mutedColor} />
                    </Pressable>
                </View>

                <Divider />

                <LabelManagerPanel maxListHeight={320} />
            </ModalContent>
        </Modal>
    )
}
