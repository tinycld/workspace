// createTextDocumentFromTemplate mirrors createBlankTextDocument's
// dependency surface — same mutate/onCreated/captureException
// contract, same fire-and-forget mutate call. We test it the same way:
// dependency-injection style with vi.fn stubs, no React tree required.
//
// The thing that's distinct from blank: the helper has to materialize
// the bytes from the template registry before calling mutate, and a
// missing/corrupt entry must surface through captureException rather
// than bubble out of the helper as a throw.

import { describe, expect, it, vi } from 'vitest'
import {
    type CreateTextDocumentFromTemplateDeps,
    createTextDocumentFromTemplate,
} from '../tinycld/text/lib/create-text-document-from-template'
import { DOCX_MIME_TYPE } from '../tinycld/text/lib/mime'
import { getTemplate, type TemplateId } from '../tinycld/text/lib/templates/index'

type Mutate = CreateTextDocumentFromTemplateDeps['mutate']

function fakeMutate(impl: (input: unknown, opts: unknown) => void): Mutate {
    return ((input: unknown, opts: unknown) => impl(input, opts)) as unknown as Mutate
}

describe('createTextDocumentFromTemplate', () => {
    it('passes a docx-tagged Blob built from the template bytes to mutate', () => {
        const mutate = vi.fn()
        const onCreated = vi.fn()
        const captureException = vi.fn()
        createTextDocumentFromTemplate({
            templateId: 'letter',
            mutate: mutate as unknown as Mutate,
            onCreated,
            captureException,
        })
        expect(mutate).toHaveBeenCalledTimes(1)
        const input = mutate.mock.calls[0][0] as {
            name: string
            mimeType: string
            body: Blob
        }
        expect(input.mimeType).toBe(DOCX_MIME_TYPE)
        expect(input.body).toBeInstanceOf(Blob)
        // Templates have real content — bytes count is non-zero, unlike
        // the blank flow's empty-blob marker.
        expect(input.body.size).toBeGreaterThan(0)
        expect(input.name).toBe(getTemplate('letter').fileName)
    })

    it('routes the freshly-minted itemId via onCreated on success', () => {
        const mutate = fakeMutate((_input, opts) => {
            const onSuccess = (opts as { onSuccess?: (r: unknown) => void } | undefined)?.onSuccess
            onSuccess?.({ itemId: 'doc-abc', finalName: 'Resume.docx', parentId: '' })
        })
        const onCreated = vi.fn()
        const captureException = vi.fn()
        createTextDocumentFromTemplate({
            templateId: 'resume',
            mutate,
            onCreated,
            captureException,
        })
        expect(onCreated).toHaveBeenCalledWith('doc-abc')
        expect(captureException).not.toHaveBeenCalled()
    })

    it('reports mutate failures via captureException with the text.createDocFromTemplate tag', () => {
        const boom = new Error('drive offline')
        const mutate = fakeMutate((_input, opts) => {
            const onError = (opts as { onError?: (e: unknown) => void } | undefined)?.onError
            onError?.(boom)
        })
        const onCreated = vi.fn()
        const captureException = vi.fn()
        createTextDocumentFromTemplate({
            templateId: 'report',
            mutate,
            onCreated,
            captureException,
        })
        expect(captureException).toHaveBeenCalledTimes(1)
        const [tag, err] = captureException.mock.calls[0]
        expect(tag).toBe('text.createDocFromTemplate')
        expect(err).toBe(boom)
        expect(onCreated).not.toHaveBeenCalled()
    })

    it('reports a missing template id via captureException without calling mutate', () => {
        const mutate = vi.fn()
        const onCreated = vi.fn()
        const captureException = vi.fn()
        createTextDocumentFromTemplate({
            templateId: 'bogus' as TemplateId,
            mutate: mutate as unknown as Mutate,
            onCreated,
            captureException,
        })
        expect(mutate).not.toHaveBeenCalled()
        expect(onCreated).not.toHaveBeenCalled()
        expect(captureException).toHaveBeenCalledTimes(1)
        const [tag, err] = captureException.mock.calls[0]
        expect(tag).toBe('text.createDocFromTemplate')
        expect(err).toBeInstanceOf(Error)
    })
})
