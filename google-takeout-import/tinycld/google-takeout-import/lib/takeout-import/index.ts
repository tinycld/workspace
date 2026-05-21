import { captureException } from '@tinycld/core/lib/errors'
import { useMutation } from '@tinycld/core/lib/mutations'
import { useTakeoutImportStore } from '@tinycld/core/lib/stores/takeout-import-store'
import * as DocumentPicker from 'expo-document-picker'
import { useCallback, useRef } from 'react'
import { Platform } from 'react-native'
import * as runImportImpl from './run-import'
import type { ImportContext, ImportService } from './types'

export { useTakeoutImportStore } from '@tinycld/core/lib/stores/takeout-import-store'

export function useTakeoutImport(context: ImportContext) {
    const store = useTakeoutImportStore()
    const contextRef = useRef(context)
    contextRef.current = context

    const detect = useCallback(
        (files: File[]) => {
            store.setPhase('detecting')

            const run = async () => {
                try {
                    const detection = await runImportImpl.detect(files, contextRef.current)
                    store.setDetection(detection)
                    store.setPhase('idle')
                } catch (err) {
                    store.setOverallError(err instanceof Error ? err.message : 'Failed to read zip files')
                    store.setPhase('error')
                    captureException('takeout-detect', err)
                }
            }
            run()
        },
        [store]
    )

    const selectFiles = useCallback(() => {
        if (Platform.OS === 'web') {
            const input = document.createElement('input')
            input.type = 'file'
            input.multiple = true
            input.accept = '.zip'
            input.onchange = () => {
                if (input.files?.length) {
                    const files = Array.from(input.files)
                    store.setFiles(files)
                    detect(files)
                }
            }
            input.click()
        } else {
            DocumentPicker.getDocumentAsync({
                multiple: true,
                type: ['application/zip'],
            }).then((result) => {
                if (result.canceled) return
                const files = result.assets.map(
                    (asset) =>
                        ({
                            uri: asset.uri,
                            name: asset.name,
                            type: 'application/zip',
                            size: asset.size ?? 0,
                        }) as unknown as File
                )
                store.setFiles(files)
                detect(files)
            })
        }
    }, [store, detect])

    const startImportMutation = useMutation({
        mutationFn: async (services: ImportService[]) => {
            store.setPhase('importing')
            store.setActiveServices(services)

            await runImportImpl.runImport(store.files, services, contextRef.current)

            if (useTakeoutImportStore.getState().cancelRequested) {
                store.setPhase('idle')
            } else {
                store.setPhase('complete')
            }
        },
        onError: (err) => {
            store.setOverallError(err instanceof Error ? err.message : 'Import failed')
            store.setPhase('error')
            captureException('takeout-import', err)
        },
    })

    const startImport = useCallback(
        (services: ImportService[]) => {
            startImportMutation.mutate(services)
        },
        [startImportMutation]
    )

    const requestCancel = useCallback(() => {
        runImportImpl.requestCancel()
    }, [])

    return {
        selectFiles,
        startImport,
        requestCancel,
        isImporting: startImportMutation.isPending,
        store,
    }
}
