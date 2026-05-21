// createBlankTextDocument is a thin orchestration helper: it builds the
// drive_items create payload, hands it to a `mutate` function (the one
// returned by `useCreateDriveItem`), and routes the call site to the new
// document on success or reports the error via captureException on failure.
//
// Same testing approach as use-print-document.test.tsx — the helper is a pure
// function that takes its collaborators as deps, so we can exercise it in a
// plain node vitest run without mounting React.

import { describe, expect, it, vi } from 'vitest'
import {
    type CreateBlankTextDocumentDeps,
    createBlankTextDocument,
} from '../tinycld/text/lib/create-blank-text-document'

type Mutate = CreateBlankTextDocumentDeps['mutate']

function makeDeps(mutate: Mutate = vi.fn()) {
    const onCreated = vi.fn()
    const captureException = vi.fn()
    return { mutate, onCreated, captureException }
}

// `mutate` is typed as TanStack Query's UseMutateFunction with several overloads;
// vi.fn typed against that full signature requires re-deriving the overload set.
// The helper below cuts through by constructing a callable that we cast to the
// expected shape — what we exercise is just the (input, options) overload.
function fakeMutate(impl: (input: unknown, opts: unknown) => void): Mutate {
    return ((input: unknown, opts: unknown) => impl(input, opts)) as unknown as Mutate
}

describe('createBlankTextDocument', () => {
    it('passes a docx-tagged blank blob to mutate', () => {
        const mutate = vi.fn()
        const deps = makeDeps(mutate as unknown as Mutate)
        createBlankTextDocument(deps)
        expect(mutate).toHaveBeenCalledTimes(1)
        const input = mutate.mock.calls[0][0] as {
            name: string
            mimeType: string
            body: Blob
        }
        expect(input.name).toBe('Untitled.docx')
        expect(input.mimeType).toBe(
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        )
        expect(input.body).toBeInstanceOf(Blob)
        expect(input.body.size).toBe(0)
    })

    it('routes via onCreated with the freshly minted item id on success', () => {
        const mutate = fakeMutate((_input, opts) => {
            const onSuccess = (opts as { onSuccess?: (r: unknown) => void } | undefined)?.onSuccess
            onSuccess?.({ itemId: 'item-123', finalName: 'Untitled.docx', parentId: '' })
        })
        const deps = makeDeps(mutate)
        createBlankTextDocument(deps)
        expect(deps.onCreated).toHaveBeenCalledWith('item-123')
        expect(deps.captureException).not.toHaveBeenCalled()
    })

    it('reports failures via captureException with the text.createDoc tag', () => {
        const boom = new Error('drive offline')
        const mutate = fakeMutate((_input, opts) => {
            const onError = (opts as { onError?: (e: unknown) => void } | undefined)?.onError
            onError?.(boom)
        })
        const deps = makeDeps(mutate)
        createBlankTextDocument(deps)
        expect(deps.captureException).toHaveBeenCalledTimes(1)
        const [tag, err] = deps.captureException.mock.calls[0]
        expect(tag).toBe('text.createDoc')
        expect(err).toBe(boom)
        expect(deps.onCreated).not.toHaveBeenCalled()
    })

    it('does not call onCreated when mutate fails via onError', () => {
        const mutate = fakeMutate((_input, opts) => {
            const onError = (opts as { onError?: (e: unknown) => void } | undefined)?.onError
            onError?.(new Error('nope'))
        })
        const deps = makeDeps(mutate)
        createBlankTextDocument(deps)
        expect(deps.onCreated).not.toHaveBeenCalled()
    })
})
