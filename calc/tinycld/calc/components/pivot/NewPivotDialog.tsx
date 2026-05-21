import { FormErrorSummary, TextInput, useForm, zodResolver } from '@tinycld/core/ui/form'
import { useEffect } from 'react'
import { Modal, Pressable, Text, View } from 'react-native'
import {
    type NewPivotFormValues,
    newPivotSchema,
} from './new-pivot-dialog-helpers'

export interface NewPivotDialogProps {
    visible: boolean
    defaultSourceRange: string
    defaultTargetSheetName: string
    onCancel: () => void
    onCreate: (args: NewPivotFormValues) => void
}

// NewPivotDialog is the modal surface for the toolbar's "Pivot table"
// button. The two text fields (source range + target sheet name) are
// pre-filled from the current selection and active sheet, and validated
// via the newPivotSchema in new-pivot-dialog-helpers.ts. On submit we
// hand the parsed/trimmed values to the caller — sheet creation, doc
// write, and panel-open all live in PivotInsertButton so this component
// stays a pure form/UI shell.
//
// React Native's <Modal> is used (not the gluestack overlay primitive)
// since this is a simple RN-only modal. The caller controls visibility;
// the dialog re-syncs its form defaults whenever it becomes visible so
// re-opening always lands on the most recent selection.
export function NewPivotDialog({
    visible,
    defaultSourceRange,
    defaultTargetSheetName,
    onCancel,
    onCreate,
}: NewPivotDialogProps) {
    const {
        control,
        handleSubmit,
        reset,
        formState: { errors, isSubmitted, isValid },
    } = useForm<NewPivotFormValues>({
        resolver: zodResolver(newPivotSchema),
        defaultValues: {
            sourceRange: defaultSourceRange,
            targetSheetName: defaultTargetSheetName,
        },
        mode: 'onChange',
    })

    // When the dialog re-opens, refresh the defaults so the user gets
    // the current selection/sheet rather than whatever was sitting in
    // the form from the previous open. `reset` re-seeds defaults and
    // clears the dirty/submitted state in one call.
    useEffect(() => {
        if (!visible) return
        reset({
            sourceRange: defaultSourceRange,
            targetSheetName: defaultTargetSheetName,
        })
    }, [visible, defaultSourceRange, defaultTargetSheetName, reset])

    const onSubmit = handleSubmit(values => {
        onCreate({
            sourceRange: values.sourceRange.trim(),
            targetSheetName: values.targetSheetName.trim(),
        })
    })

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onCancel}
            accessibilityLabel="Insert pivot table"
        >
            <View
                className="flex-1 items-center justify-center bg-black/50"
                {...(typeof document !== 'undefined'
                    ? { role: 'dialog', 'aria-label': 'Insert pivot table' }
                    : {})}
            >
                <View
                    className="w-[480px] bg-background rounded-lg border border-border"
                    style={{ padding: 20 }}
                    {...(typeof document !== 'undefined'
                        ? { 'data-test-id': 'new-pivot-dialog' }
                        : {})}
                >
                    <Text className="text-lg font-semibold text-foreground mb-4">
                        Insert pivot table
                    </Text>
                    <FormErrorSummary errors={errors} isEnabled={isSubmitted} />
                    <TextInput
                        control={control}
                        name="sourceRange"
                        label="Source range"
                        placeholder="Sheet1!A1:E100"
                        hint="The data range to summarize."
                        autoFocus
                        autoCapitalize="none"
                    />
                    <TextInput
                        control={control}
                        name="targetSheetName"
                        label="New sheet name"
                        hint="The pivot output will live on this sheet."
                    />
                    <View className="flex-row justify-end gap-2 mt-2">
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Cancel"
                            onPress={onCancel}
                            className="rounded-md border border-border px-3 py-2"
                        >
                            <Text className="text-sm text-foreground">Cancel</Text>
                        </Pressable>
                        <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Create pivot table"
                            disabled={!isValid}
                            onPress={onSubmit}
                            className={
                                isValid
                                    ? 'rounded-md bg-accent px-3 py-2'
                                    : 'rounded-md bg-muted px-3 py-2 opacity-60'
                            }
                        >
                            <Text
                                className={
                                    isValid
                                        ? 'text-sm font-medium text-accent-foreground'
                                        : 'text-sm font-medium text-muted-foreground'
                                }
                            >
                                Create
                            </Text>
                        </Pressable>
                    </View>
                </View>
            </View>
        </Modal>
    )
}
