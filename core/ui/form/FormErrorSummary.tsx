import type { FieldErrors } from 'react-hook-form'
import { Text, View } from 'react-native'

type ErrorEntry = {
    key: string
    message: string
}

const IGNORED_ERROR_KEYS = new Set(['type', 'ref', 'message', 'types'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null

const flattenErrorValue = (value: unknown, keyPath: string): ErrorEntry[] => {
    if (!value) return []

    if (Array.isArray(value)) {
        return value.flatMap((item, index) =>
            flattenErrorValue(item, keyPath ? `${keyPath}[${index}]` : `[${index}]`)
        )
    }

    if (isRecord(value)) {
        return flattenRecordErrors(value, keyPath)
    }

    return typeof value === 'string' ? [{ key: keyPath || 'form', message: value }] : []
}

const flattenRecordErrors = (record: Record<string, unknown>, keyPath: string): ErrorEntry[] => {
    const currentKey = keyPath || 'form'
    const entries: ErrorEntry[] = []

    const message = typeof record.message === 'string' ? record.message : null
    if (message) entries.push({ key: currentKey, message })

    if (isRecord(record.types)) {
        for (const val of Object.values(record.types)) {
            if (typeof val === 'string') entries.push({ key: currentKey, message: val })
        }
    }

    for (const [nestedKey, nestedValue] of Object.entries(record)) {
        if (IGNORED_ERROR_KEYS.has(nestedKey)) continue
        const nextKey = keyPath ? `${keyPath}.${nestedKey}` : nestedKey
        entries.push(...flattenErrorValue(nestedValue, nextKey))
    }

    return entries
}

const extractErrorEntries = (errors: FieldErrors): ErrorEntry[] =>
    Object.entries(errors).flatMap(([key, value]) => flattenErrorValue(value, key))

export interface FormErrorSummaryProps {
    errors: FieldErrors
    title?: string
    testID?: string
    isEnabled?: boolean
}

export function FormErrorSummary({
    errors,
    title = 'Please fix the following errors:',
    testID,
    isEnabled = false,
}: FormErrorSummaryProps) {
    if (!isEnabled) return null

    const errorEntries = extractErrorEntries(errors)
    if (errorEntries.length === 0) return null

    return (
        <View
            className="bg-danger-soft border border-danger-soft-foreground rounded-lg p-3 mb-3"
            testID={testID}
        >
            <Text className="text-sm font-semibold text-danger mb-2">{title}</Text>
            {errorEntries.map(entry => (
                <Text key={`${entry.key}-${entry.message}`} className="text-xs text-danger mb-1">
                    {entry.key}: {entry.message || 'Invalid value'}
                </Text>
            ))}
        </View>
    )
}
