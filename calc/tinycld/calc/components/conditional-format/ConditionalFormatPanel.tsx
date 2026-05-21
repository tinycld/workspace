// Right-anchored Drawer hosting the conditional-formatting authoring
// UI. Visibility and editing target come from the
// useConditionalFormatPanelStore. The drawer itself owns no state
// beyond the in-edit form draft. Mutations route through
// lib/conditional-format/mutate.ts so rule edits ride the calc undo
// manager (SHEETS_MAP is in the undo scope).

import {
    Drawer,
    DrawerBackdrop,
    DrawerBody,
    DrawerCloseButton,
    DrawerContent,
    DrawerFooter,
    DrawerHeader,
} from '@tinycld/core/ui/drawer'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Plus, Trash2, X } from 'lucide-react-native'
import { useMemo, useRef } from 'react'
import { Platform, Pressable, Text, View } from 'react-native'
import type * as Y from 'yjs'
import { useSheetConditionalFormats } from '../../hooks/use-sheet-conditional-formats'
import {
    addRule,
    deleteRule,
    newRuleId,
    updateRule,
} from '../../lib/conditional-format/mutate'
import type { CFRule } from '../../lib/conditional-format/types'
import {
    NEW_RULE_ID,
    useConditionalFormatPanelStore,
} from '../../lib/stores/conditional-format-panel-store'
import { RuleEditor, RuleEditorActions, type RuleEditorHandle } from './RuleEditor'
import { RuleListRow } from './RuleListRow'

export interface ConditionalFormatPanelProps {
    doc: Y.Doc
    sheetId: string
    readOnly?: boolean
}

export function ConditionalFormatPanel({
    doc,
    sheetId,
    readOnly,
}: ConditionalFormatPanelProps) {
    const openForSheetId = useConditionalFormatPanelStore((s) => s.openForSheetId)
    const close = useConditionalFormatPanelStore((s) => s.close)
    const editingRuleId = useConditionalFormatPanelStore((s) => s.editingRuleId)
    const defaultRanges = useConditionalFormatPanelStore((s) => s.defaultRanges)
    const setEditingRule = useConditionalFormatPanelStore((s) => s.setEditingRule)
    const rules = useSheetConditionalFormats(doc, sheetId)
    const iconColor = useThemeColor('foreground')

    const isOpen = openForSheetId === sheetId

    const editingRule = useMemo<CFRule | null>(() => {
        if (editingRuleId == null) return null
        if (editingRuleId === NEW_RULE_ID) {
            return makeDraftRule(defaultRanges)
        }
        return rules.find((r) => r.id === editingRuleId) ?? null
    }, [editingRuleId, defaultRanges, rules])

    const editorRef = useRef<RuleEditorHandle | null>(null)

    const onAdd = () => setEditingRule(NEW_RULE_ID)
    const onEdit = (id: string) => setEditingRule(id)
    const onCancel = () => setEditingRule(null)
    const onDelete = (id: string) => {
        deleteRule(doc, sheetId, id)
    }
    const onDone = () => {
        const rule = editorRef.current?.commit()
        if (rule == null) return
        if (editingRuleId === NEW_RULE_ID) {
            addRule(doc, sheetId, rule)
        } else if (editingRuleId != null) {
            updateRule(doc, sheetId, editingRuleId, rule)
        }
        setEditingRule(null)
    }

    return (
        <Drawer isOpen={isOpen} onClose={close} anchor="right" size="md">
            <DrawerBackdrop />
            <DrawerContent>
                <DrawerHeader>
                    <Text className="text-base font-medium text-foreground">
                        Conditional format rules
                    </Text>
                    <DrawerCloseButton onPress={close}>
                        <X size={18} color={iconColor} />
                    </DrawerCloseButton>
                </DrawerHeader>
                <DrawerBody>
                    {editingRule != null ? (
                        <RuleEditor
                            ref={editorRef}
                            key={editingRuleId ?? 'editor'}
                            rule={editingRule}
                            readOnly={readOnly}
                        />
                    ) : (
                        <RuleList
                            rules={rules}
                            readOnly={readOnly}
                            onAdd={onAdd}
                            onEdit={onEdit}
                            onDelete={onDelete}
                        />
                    )}
                </DrawerBody>
                {editingRule != null ? (
                    <DrawerFooter>
                        <RuleEditorActions
                            onCancel={onCancel}
                            onDone={onDone}
                            disabled={readOnly}
                        />
                    </DrawerFooter>
                ) : null}
            </DrawerContent>
        </Drawer>
    )
}

interface RuleListProps {
    rules: CFRule[]
    readOnly: boolean | undefined
    onAdd: () => void
    onEdit: (id: string) => void
    onDelete: (id: string) => void
}

function RuleList({ rules, readOnly, onAdd, onEdit, onDelete }: RuleListProps) {
    const trashColor = useThemeColor('muted-foreground')
    return (
        <View>
            {rules.length === 0 ? (
                <Text className="py-2 text-sm text-muted-foreground">
                    No rules yet. Add one to highlight cells based on their
                    values.
                </Text>
            ) : (
                rules.map((rule) => (
                    <View
                        key={rule.id}
                        className="mb-2 flex-row items-center gap-2"
                    >
                        <Pressable
                            className="flex-1"
                            onPress={() => onEdit(rule.id)}
                        >
                            <RuleListRow rule={rule} />
                        </Pressable>
                        <Pressable
                            onPress={() => onDelete(rule.id)}
                            disabled={readOnly}
                            accessibilityLabel="Delete rule"
                            hitSlop={6}
                        >
                            <Trash2 size={16} color={trashColor} />
                        </Pressable>
                    </View>
                ))
            )}
            <Pressable
                className="mt-2 flex-row items-center gap-1 self-start rounded px-2 py-1"
                onPress={onAdd}
                disabled={readOnly}
                accessibilityLabel="Add rule"
                hitSlop={Platform.OS === 'web' ? undefined : { top: 6, bottom: 6, left: 4, right: 4 }}
            >
                <Plus size={14} color={trashColor} />
                <Text className="text-sm text-foreground">Add another rule</Text>
            </Pressable>
        </View>
    )
}

function makeDraftRule(defaultRanges: string[]): CFRule {
    return {
        id: newRuleId(),
        ranges: defaultRanges.length > 0 ? defaultRanges.slice() : [''],
        condition: { type: 'isNotEmpty' },
        style: { fill: { type: 'pattern', pattern: 'solid', fgColor: '#FFF2CC' } },
    }
}
