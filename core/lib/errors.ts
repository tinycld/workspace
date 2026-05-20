import { notify } from '@tinycld/core/lib/notify/dispatcher'
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'
import { captureExceptionToSentry } from './sentry'

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null

function getBaseMessage(error: Record<string, unknown>): string {
    let msg = ''
    if (typeof error.message === 'string') msg = error.message

    const nested = error.originalError ?? error.cause
    if (isRecord(nested) && typeof nested.message === 'string' && nested.message) {
        msg = nested.message
    }
    return msg
}

function formatResponseFieldErrors(data: Record<string, unknown>): string[] {
    const errors: string[] = []
    for (const [field, fieldError] of Object.entries(data)) {
        if (field === 'message' || field === 'status') continue
        if (!isRecord(fieldError)) continue

        if (typeof fieldError.message === 'string') {
            errors.push(`${field}: ${fieldError.message}`)
        } else if (typeof fieldError.code === 'string') {
            errors.push(`${field}: ${fieldError.code.replace(/_/g, ' ')}`)
        }
    }
    return errors
}

export function errorToString(error: unknown, fallback = 'An unexpected error occurred'): string {
    if (typeof error === 'string') return error
    if (!isRecord(error)) return fallback

    const msg = getBaseMessage(error)
    const response = error.response

    if (!isRecord(response)) return msg || fallback

    if (isRecord(response.data)) {
        const fieldErrors = formatResponseFieldErrors(response.data)
        const prefix = msg ? `${msg} ` : ''

        if (fieldErrors.length > 0) return prefix + fieldErrors.join(', ')
        if (typeof response.data.message === 'string') return prefix + response.data.message
        if (typeof response.data.error === 'string') return prefix + response.data.error
    }

    if (typeof error.error === 'string') return error.error
    if (isRecord(error.data) && typeof error.data.message === 'string') return error.data.message

    return msg || fallback
}

function extractFieldErrors(data: Record<string, unknown>): Record<string, string> | null {
    const errors: Record<string, string> = {}

    for (const [field, fieldError] of Object.entries(data)) {
        if (isRecord(fieldError)) {
            if (typeof fieldError.message === 'string') {
                errors[field] = fieldError.message
            } else if (typeof fieldError.code === 'string') {
                errors[field] = `Validation failed: ${fieldError.code}`
            }
        } else if (typeof fieldError === 'string') {
            errors[field] = fieldError
        }
    }

    return Object.keys(errors).length > 0 ? errors : null
}

function getBatchRequestData(data: Record<string, unknown>): Record<string, unknown> | null {
    if (!isRecord(data.requests)) return null
    const firstRequest = data.requests['0']
    if (!isRecord(firstRequest)) return null
    if (!isRecord(firstRequest.response) || !isRecord(firstRequest.response.data)) return null
    return firstRequest.response.data
}

export function extractValidationErrors(error: unknown): Record<string, string> | null {
    if (!isRecord(error)) return null

    if (isRecord(error.response) && isRecord(error.response.data)) {
        const data = error.response.data

        const batchData = getBatchRequestData(data)
        if (batchData) {
            const result = extractFieldErrors(batchData)
            if (result) return result
        }

        if (isRecord(data.data)) {
            const result = extractFieldErrors(data.data)
            if (result) return result
        }
    }

    if (isRecord(error.errors)) {
        return Object.fromEntries(
            Object.entries(error.errors).filter(([, value]) => typeof value === 'string') as [
                string,
                string,
            ][]
        )
    }

    return null
}

export interface FormErrorHandler<T extends FieldValues = FieldValues> {
    setError: UseFormSetError<T>
    getValues: () => T
    /** Short label describing what the form was doing, surfaced in telemetry. */
    operation?: string
}

export function handleMutationErrorsWithForm<T extends FieldValues = FieldValues>(
    form: FormErrorHandler<T>
) {
    return (error: unknown) => {
        const validationErrors = extractValidationErrors(error)

        if (validationErrors) {
            const formValues = form.getValues()
            const formFields = Object.keys(formValues as Record<string, unknown>)
            const errorFields = Object.keys(validationErrors)
            const unknownFields = errorFields.filter(field => !formFields.includes(field))

            if (unknownFields.length === 0) {
                for (const [field, message] of Object.entries(validationErrors)) {
                    form.setError(field as Path<T>, {
                        type: 'manual',
                        message,
                    })
                }
                return
            }
        }

        const message = errorToString(error)
        notify.emit({
            event: 'mutation.error',
            title: 'Something went wrong',
            body: message,
            data: { operation: form.operation ?? 'unknown', error: message },
        })
    }
}

export function captureException(context: string, error: unknown, extra?: Record<string, unknown>) {
    captureExceptionToSentry(context, error, extra)
}
