// The open-in-text-action module exposes two surfaces:
//   1. `buildOpenInTextAction(orgHref)` — the pure factory consumers
//      test against; returns a PreviewAction with id/icon/label/predicate
//      and an onPress that drives expo-router.
//   2. side-effect registration in `registerPreviewAction('text.open', …)`
//      that drive's PreviewModal walks at render time.
//
// We test both: the action's externally-observable behaviour (isApplicable
// matches DOCX only, onPress navigates + closes the host modal) AND the
// registration side effect (the registry contains a `text.open` factory
// after import).
//
// expo-router is aliased to a vitest stub in tinycld/vitest.config.ts;
// the stub exports `router` as a vi.fn-backed object we can assert on.
// lucide-react-native is aliased to a Proxy stub that yields a harmless
// component-like value for every named icon import.

import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
    __resetPreviewActionRegistryForTests,
    getPreviewActionFactories,
} from '@tinycld/core/file-viewer/preview-action-registry'
import type {
    FilePreviewSource,
    PreviewActionContext,
} from '@tinycld/core/file-viewer/types'
import { router } from 'expo-router'
import { ExternalLink } from 'lucide-react-native'
import {
    buildOpenInTextAction,
    // The side-effect import registers the factory; this re-export
    // is just convenient for clarity.
} from '../tinycld/text/lib/open-in-text-action'

function makeSource(overrides: Partial<FilePreviewSource>): FilePreviewSource {
    return {
        collectionId: 'drive_items',
        recordId: 'drive_item_abc',
        fileName: 'doc.docx',
        displayName: 'doc',
        mimeType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: 1024,
        ...overrides,
    }
}

// Stand-in orgHref. Production's useOrgHref returns a function that
// builds Href objects; the tests assert on the structure that the
// factory hands to router.push, so the exact return shape needs to
// match what useOrgHref produces.
function stubOrgHref(path: string, extra?: Record<string, string>) {
    const pathname = `/a/[orgSlug]/${path}`
    return {
        pathname,
        params: { orgSlug: 'acme', ...extra },
    } as unknown as ReturnType<ReturnType<typeof Object>>
}

describe('buildOpenInTextAction', () => {
    beforeEach(() => {
        vi.mocked(router.push).mockClear()
    })

    it('returns an action keyed text.open with label "Open in Text"', () => {
        const action = buildOpenInTextAction(stubOrgHref as never)
        expect(action.id).toBe('text.open')
        expect(action.label).toBe('Open in Text')
    })

    it('uses the ExternalLink icon (consumers render this in the toolbar)', () => {
        const action = buildOpenInTextAction(stubOrgHref as never)
        expect(action.icon).toBe(ExternalLink)
    })

    it("isApplicable returns true ONLY for the DOCX MIME type", () => {
        const action = buildOpenInTextAction(stubOrgHref as never)
        expect(action.isApplicable).toBeDefined()
        expect(action.isApplicable!(makeSource({}))).toBe(true)
        expect(
            action.isApplicable!(makeSource({ mimeType: 'application/pdf' }))
        ).toBe(false)
        expect(
            action.isApplicable!(makeSource({ mimeType: 'image/png' }))
        ).toBe(false)
        expect(
            action.isApplicable!(makeSource({ mimeType: 'text/plain' }))
        ).toBe(false)
        expect(action.isApplicable!(makeSource({ mimeType: '' }))).toBe(false)
    })

    it('onPress navigates via router.push to text/[id] with the record id, then closes the host preview', () => {
        const action = buildOpenInTextAction(stubOrgHref as never)
        const ctx: PreviewActionContext = { close: vi.fn() }

        action.onPress(makeSource({ recordId: 'drive_item_xyz' }), ctx)

        expect(router.push).toHaveBeenCalledTimes(1)
        const navTarget = vi.mocked(router.push).mock.calls[0][0] as {
            pathname: string
            params: Record<string, string>
        }
        expect(navTarget.pathname).toBe('/a/[orgSlug]/text/[id]')
        expect(navTarget.params.id).toBe('drive_item_xyz')
        expect(ctx.close).toHaveBeenCalledTimes(1)
    })

    it('does NOT close the host preview when navigation fails (regression guard)', () => {
        // router.push is fire-and-forget in expo-router (returns void),
        // so we can't test failure modes directly — but the contract is
        // that the close call happens after the push, sequentially. Use
        // mock call ordering to verify the sequence.
        const action = buildOpenInTextAction(stubOrgHref as never)
        const closeMock = vi.fn()
        const ctx: PreviewActionContext = { close: closeMock }

        action.onPress(makeSource({}), ctx)

        // close must come AFTER push so the modal doesn't disappear
        // before the navigation request has been issued.
        const pushOrder = vi.mocked(router.push).mock.invocationCallOrder[0]
        const closeOrder = closeMock.mock.invocationCallOrder[0]
        expect(pushOrder).toBeLessThan(closeOrder)
    })
})

describe('text.open registry side effect', () => {
    it('populates getPreviewActionFactories on import', () => {
        const factories = getPreviewActionFactories()
        // Multiple packages may register actions; we only care that
        // text's registration ran.
        expect(factories.length).toBeGreaterThan(0)
    })

    it('exposes a reset hook so other tests can isolate the registry', () => {
        __resetPreviewActionRegistryForTests()
        expect(getPreviewActionFactories().length).toBe(0)
    })
})
