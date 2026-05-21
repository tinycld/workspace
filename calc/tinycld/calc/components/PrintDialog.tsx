import { fetchRenderedHtml } from '@tinycld/core/file-viewer/fetch-rendered-html'
import {
    captureException,
    handleMutationErrorsWithForm,
} from '@tinycld/core/lib/errors'
import { useMutation } from '@tinycld/core/lib/mutations'
import { renderPrintEnvelope } from '@tinycld/core/lib/print/render-print-envelope'
import {
    FormErrorSummary,
    useForm,
    zodResolver,
} from '@tinycld/core/ui/form'
import { Modal, ModalBackdrop, ModalContent } from '@tinycld/core/ui/modal'
import { useMemo } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import type * as Y from 'yjs'
import { useYSheets } from '../hooks/use-y-sheets'
import { handlePrint } from '../lib/print/handle-print'
import { buildPrintCss } from '../lib/print/print-css'
import {
    DEFAULT_PRINT_CONFIG,
    type PrintConfig,
    printConfigSchema,
} from '../lib/print/types'
import { columnLabel } from '../lib/workbook-types'
import { PrintLayoutFields } from './print/PrintLayoutFields'
import { PrintPageFields } from './print/PrintPageFields'
import { PrintScopeFields } from './print/PrintScopeFields'

// PrintSelection mirrors the shape the grid hands to the dialog: a
// sheet ID + an inclusive 1-based rectangle. `null` means "no active
// selection — fall back to the used range". Re-declared locally
// because the old snapshot.ts module that owned this type has been
// retired in favor of the server render path.
export interface PrintSelection {
    sheetId: string
    rect: { startRow: number; startCol: number; endRow: number; endCol: number }
}

export interface PrintDialogProps {
    isOpen: boolean
    onClose: () => void
    doc: Y.Doc
    driveItemId: string
    currentSheetId: string
    currentSelection: PrintSelection | null
}

// rectToA1 stringifies a selection rect into the A1 form the server
// render endpoint accepts.
function rectToA1(rect: PrintSelection['rect']): string {
    const start = `${columnLabel(rect.startCol)}${rect.startRow}`
    const end = `${columnLabel(rect.endCol)}${rect.endRow}`
    return start === end ? start : `${start}:${end}`
}

interface SheetMeta {
    id: string
    name: string
}

// resolveTargets translates the user's sheet-scope choice into the
// concrete (sheetName, optional A1 range) pairs we send to the
// render endpoint. The endpoint renders one sheet per call, so a
// multi-sheet scope becomes multiple calls whose fragments are
// concatenated before being wrapped in the print envelope.
function resolveTargets(
    config: PrintConfig,
    sheets: SheetMeta[],
    currentSheetId: string,
    currentSelection: PrintSelection | null
): { name: string; range?: string }[] {
    const scope = config.scope.sheets
    let chosen: SheetMeta[]
    if (scope === 'all') {
        chosen = sheets
    } else if (scope === 'current') {
        chosen = sheets.filter(s => s.id === currentSheetId)
    } else {
        const idSet = new Set(scope.ids)
        chosen = sheets.filter(s => idSet.has(s.id))
    }
    return chosen.map(s => {
        if (
            config.scope.range === 'selection' &&
            currentSelection != null &&
            currentSelection.sheetId === s.id
        ) {
            return { name: s.name, range: rectToA1(currentSelection.rect) }
        }
        return { name: s.name }
    })
}

// PrintDialog opens from the toolbar's PrintButton. It captures a fresh
// PrintConfig via React Hook Form, calls the server render endpoint
// once per target sheet, joins the fragments under a single print
// envelope, and hands the HTML off to handlePrint. The dialog stays
// open while the print flow runs — on web the print container +
// window.print() happens in front of it; on native the system print
// sheet covers it.
export function PrintDialog({
    isOpen,
    onClose,
    doc,
    driveItemId,
    currentSheetId,
    currentSelection,
}: PrintDialogProps) {
    const sheets = useYSheets(doc)
    const sheetList = useMemo(
        () => sheets.map(s => ({ id: s.id, name: s.name })),
        [sheets]
    )
    const selectionAvailable =
        currentSelection != null && currentSelection.sheetId === currentSheetId

    const {
        control,
        handleSubmit,
        watch,
        setError,
        getValues,
        formState: { errors, isSubmitted },
    } = useForm<PrintConfig>({
        resolver: zodResolver(printConfigSchema),
        defaultValues: DEFAULT_PRINT_CONFIG,
        mode: 'onChange',
    })

    const scopeValue = watch('scope.sheets')

    const submitDisabled =
        typeof scopeValue === 'object' && scopeValue.ids.length === 0

    // useMutation gives us the failure-surface the previous
    // handleSubmit-only path was missing: onError lands in
    // FormErrorSummary via handleMutationErrorsWithForm, and Sentry
    // gets a captureException so silent print failures show up in
    // the error tracker. isPending replaces the previous reliance on
    // formState.isSubmitting (which only tracks form validation, not
    // the post-validation async work).
    const printMutation = useMutation<void, Error, PrintConfig>({
        mutationFn: async (config: PrintConfig) => {
            const targets = resolveTargets(
                config,
                sheetList,
                currentSheetId,
                currentSelection
            )
            const fragments: string[] = []
            const source = {
                collectionId: 'drive_items',
                recordId: driveItemId,
                fileName: '',
                displayName: '',
                mimeType:
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                size: 0,
            }
            for (const target of targets) {
                const { html } = await fetchRenderedHtml(source, {
                    sheet: target.name,
                    range: target.range,
                    scope: 'selection',
                    images: 'embed',
                })
                fragments.push(html)
            }
            const envelope = renderPrintEnvelope(fragments.join(''), buildPrintCss(config))
            // Close the dialog before invoking handlePrint so the
            // Modal's react-aria FocusScope tears down before we
            // append #tinycld-print-root to <body>. Otherwise the
            // active FocusScope picks up the print container and,
            // when handlePrint's `afterprint` cleanup removes it,
            // FocusScope's tree walk dereferences an orphaned
            // sibling sentinel — "Cannot read properties of
            // undefined (reading 'previousElementSibling')".
            onClose()
            await handlePrint(envelope)
        },
        onError: (err) => {
            captureException('calc.print', err)
            handleMutationErrorsWithForm({ setError, getValues })(err)
        },
    })

    const onSubmit = handleSubmit((config) => printMutation.mutate(config))

    return (
        <Modal isOpen={isOpen} onClose={onClose}>
            <ModalBackdrop />
            <ModalContent className="w-[520px] max-h-[640px] p-0 rounded-xl bg-background">
                <View className="px-5 pt-4 pb-3 border-b border-border">
                    <Text className="text-base font-semibold text-foreground">
                        Print
                    </Text>
                </View>
                <ScrollView className="px-5 py-4" style={{ maxHeight: 480 }}>
                    <FormErrorSummary errors={errors} isEnabled={isSubmitted} />
                    <View style={{ gap: 16 }}>
                        <PrintScopeFields
                            control={control}
                            sheets={sheetList}
                            selectionAvailable={selectionAvailable}
                        />
                        <PrintPageFields control={control} />
                        <PrintLayoutFields control={control} />
                    </View>
                </ScrollView>
                <View
                    className="flex-row justify-end px-5 py-3 border-t border-border"
                    style={{ gap: 8 }}
                >
                    <Pressable
                        onPress={onClose}
                        accessibilityRole="button"
                        className="px-3 py-2 rounded-md border border-border bg-background"
                    >
                        <Text className="text-sm text-foreground">Cancel</Text>
                    </Pressable>
                    <Pressable
                        onPress={onSubmit}
                        disabled={submitDisabled || printMutation.isPending}
                        accessibilityRole="button"
                        className="px-3 py-2 rounded-md bg-primary disabled:opacity-50"
                    >
                        <Text className="text-sm text-primary-foreground">Print</Text>
                    </Pressable>
                    <FormErrorSummary errors={errors} isEnabled={isSubmitted} />
                </View>
            </ModalContent>
        </Modal>
    )
}
