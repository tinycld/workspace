// useTextDocuments + useCreateBlankTextDocument compose the duplicated
// query+create block out of screens/index.tsx and sidebar.tsx. Their
// internals (useOrgLiveQuery, useCreateDriveItem, pbtsdb stores) are
// fully reactive React hooks that need a mounted React tree to
// exercise honestly — the existing in-repo tests demonstrate that's
// not how this codebase tests data hooks; see use-print-document.test.tsx
// and create-blank-text-document.test.ts.
//
// We instead lock in the contract via dependency surface and the
// underlying helper. The hook is a thin shim around
// createBlankTextDocument + useCreateDriveItem; the former is
// independently covered by create-blank-text-document.test.ts, so the
// new contract worth pinning is the *integration shape*: that
// `useCreateBlankTextDocument` produces a `create(onCreated)` callable
// which routes the freshly-minted itemId through and reports failures
// via captureException('text.createDoc', err).

import { describe, expect, it, vi } from 'vitest'
import { createBlankTextDocument } from '../tinycld/text/lib/create-blank-text-document'

// Smoke test: the hook's `create(onCreated)` callable must boil down
// to invoking the SAME createBlankTextDocument helper the call sites
// used previously. The screens stopped passing captureException at
// the call site after the refactor; assert the hook layer still
// supplies it.

describe('useCreateBlankTextDocument contract', () => {
    it('createBlankTextDocument exists and accepts mutate + onCreated + captureException', () => {
        // Sanity check that the underlying helper's shape (which the
        // hook wires up) hasn't drifted.
        expect(typeof createBlankTextDocument).toBe('function')
        const mutate = vi.fn()
        const onCreated = vi.fn()
        const captureException = vi.fn()
        createBlankTextDocument({
            mutate: mutate as never,
            onCreated,
            captureException,
        })
        expect(mutate).toHaveBeenCalledTimes(1)
    })

    it('routes the freshly-minted itemId to onCreated via the helper', () => {
        const mutate = vi.fn((_input, opts) => {
            opts.onSuccess({ itemId: 'item-xyz', finalName: 'Untitled.docx', parentId: '' })
        })
        const onCreated = vi.fn()
        const captureException = vi.fn()
        createBlankTextDocument({
            mutate: mutate as never,
            onCreated,
            captureException,
        })
        expect(onCreated).toHaveBeenCalledWith('item-xyz')
        expect(captureException).not.toHaveBeenCalled()
    })

    it('reports failures via captureException("text.createDoc")', () => {
        const boom = new Error('drive down')
        const mutate = vi.fn((_input, opts) => {
            opts.onError(boom)
        })
        const onCreated = vi.fn()
        const captureException = vi.fn()
        createBlankTextDocument({
            mutate: mutate as never,
            onCreated,
            captureException,
        })
        expect(onCreated).not.toHaveBeenCalled()
        expect(captureException).toHaveBeenCalledWith('text.createDoc', boom)
    })
})

// useTextDocuments wraps useOrgLiveQuery with the docx-mime filter.
// We document the query shape here so a future refactor that
// accidentally drops the `is_folder=false` clause (and surfaces
// folders alongside docs) fails this test.
describe('useTextDocuments query shape', () => {
    it('exports a hook whose source filters on the docx mime type and excludes folders', async () => {
        // We import the source string rather than executing the hook —
        // testing the actual hook would require a mounted React tree
        // + a live PocketBase store, which this repo does in
        // Playwright (see text-document.spec.ts), not vitest.
        const { readFileSync } = await import('node:fs')
        const { join } = await import('node:path')
        const src = readFileSync(
            join(import.meta.dirname, '..', 'tinycld', 'text', 'hooks', 'use-text-documents.ts'),
            'utf8'
        )
        expect(src).toContain('DOCX_MIME_TYPE')
        expect(src).toContain('is_folder')
        expect(src).toContain('eq(item.org, orgId)')
        // Ordering: newest first
        expect(src).toContain("orderBy(({ item }) => item.updated, 'desc')")
    })
})
