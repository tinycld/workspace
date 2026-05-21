import { describe, expect, it, vi } from 'vitest'
import {
    SLASH_MENU_COMMANDS,
    type SlashMenuCommand,
} from '../tinycld/text/lib/editor/slash-menu-commands'
import { createSlashMenuBridgeRender } from '../tinycld/text/lib/editor/slash-menu-render-bridge'
import {
    serializeSlashMenuItems,
    toAnchoredSlashMenuRect,
} from '../tinycld/text/lib/editor/slash-menu-shared'

// slash-menu-bridge tests: the bridge render strategy is the WebView
// side of the anchored-overlay protocol. We test the wire-shape
// contracts by stubbing the deps the factory accepts (postToHost,
// newRequestId, exitSuggestion) and driving the returned lifecycle
// callbacks (onStart, onUpdate, onKeyDown, onExit) with synthetic
// SuggestionProps shapes. The full Tiptap-suggestion-plugin wiring is
// Playwright's job; here we lock the message contract.

function makeRect(over: Partial<DOMRect> = {}): DOMRect {
    return {
        top: 200,
        left: 50,
        right: 58,
        bottom: 218,
        width: 8,
        height: 18,
        x: 50,
        y: 200,
        toJSON: () => ({}),
        ...over,
    } as DOMRect
}

function makeProps(over: Record<string, unknown> = {}) {
    return {
        editor: { view: {} as unknown },
        items: SLASH_MENU_COMMANDS.slice(0, 3),
        query: '',
        text: '/',
        range: { from: 1, to: 2 },
        clientRect: () => makeRect(),
        command: vi.fn(),
        decorationNode: null,
        ...over,
    }
}

describe('serializeSlashMenuItems', () => {
    it('strips icon refs and run handlers, keeps id/label/iconName', () => {
        const out = serializeSlashMenuItems(SLASH_MENU_COMMANDS.slice(0, 2))
        expect(out).toEqual([
            { id: 'heading-1', label: 'Heading 1', iconName: 'Heading1' },
            { id: 'heading-2', label: 'Heading 2', iconName: 'Heading2' },
        ])
    })
})

describe('toAnchoredSlashMenuRect', () => {
    it('returns null when no rect is provided', () => {
        expect(toAnchoredSlashMenuRect(null)).toBeNull()
        expect(toAnchoredSlashMenuRect(undefined)).toBeNull()
    })

    it('preserves viewport coords and adds scroll snapshot', () => {
        const out = toAnchoredSlashMenuRect(makeRect({ top: 10, left: 20, width: 8, height: 18 }))
        expect(out).toEqual({
            top: 10,
            left: 20,
            width: 8,
            height: 18,
            // scrollX/scrollY pulled from window — in node test env
            // window is undefined under environment:'node', so the
            // fallbacks fire (0 / 0).
            scrollX: 0,
            scrollY: 0,
        })
    })
})

describe('createSlashMenuBridgeRender — wire shape', () => {
    it('posts ui.show-popover with kind/rect/items on onStart', () => {
        const postToHost = vi.fn()
        const newRequestId = vi.fn().mockReturnValue('req-1')
        const exitSuggestionStub = vi.fn()
        const render = createSlashMenuBridgeRender({
            postToHost,
            newRequestId,
            exitSuggestion: exitSuggestionStub,
        })
        const handlers = render()

        handlers.onStart?.(makeProps() as never)

        expect(postToHost).toHaveBeenCalledTimes(1)
        const msg = postToHost.mock.calls[0]?.[0] as {
            namespace: string
            type: string
            requestId: string
            payload: {
                kind: string
                rect: object
                payload: {
                    items: { id: string; iconName: string; label: string }[]
                    query: string
                    selectedIndex: number
                }
            }
        }
        expect(msg.namespace).toBe('ui')
        expect(msg.type).toBe('show-popover')
        expect(msg.requestId).toBe('req-1')
        expect(msg.payload.kind).toBe('slash-menu')
        expect(msg.payload.payload.selectedIndex).toBe(0)
        expect(msg.payload.payload.query).toBe('')
        expect(msg.payload.payload.items[0]?.id).toBe('heading-1')
        expect(msg.payload.payload.items[0]?.iconName).toBe('Heading1')
    })

    it('drops onStart when clientRect returns null (no anchor → no popover)', () => {
        const postToHost = vi.fn()
        const newRequestId = vi.fn().mockReturnValue('req-1')
        const render = createSlashMenuBridgeRender({
            postToHost,
            newRequestId,
            exitSuggestion: vi.fn(),
        })
        const handlers = render()
        handlers.onStart?.(makeProps({ clientRect: () => null }) as never)
        expect(postToHost).not.toHaveBeenCalled()
    })

    it('posts ui.popover-update on onUpdate with the same requestId', () => {
        const postToHost = vi.fn()
        const render = createSlashMenuBridgeRender({
            postToHost,
            newRequestId: () => 'req-2',
            exitSuggestion: vi.fn(),
        })
        const handlers = render()
        handlers.onStart?.(makeProps() as never)
        postToHost.mockClear()

        handlers.onUpdate?.(
            makeProps({
                items: SLASH_MENU_COMMANDS.filter(c => c.id.startsWith('heading')),
                query: 'h',
            }) as never
        )

        expect(postToHost).toHaveBeenCalledTimes(1)
        const msg = postToHost.mock.calls[0]?.[0] as {
            namespace: string
            type: string
            requestId: string
            payload: { items: unknown[]; query: string; selectedIndex: number }
        }
        expect(msg.namespace).toBe('ui')
        expect(msg.type).toBe('popover-update')
        expect(msg.requestId).toBe('req-2')
        expect(msg.payload.query).toBe('h')
        expect((msg.payload.items as { id: string }[]).map(i => i.id)).toEqual([
            'heading-1',
            'heading-2',
            'heading-3',
        ])
    })

    it('bumps selectedIndex on ArrowDown and posts popover-update', () => {
        const postToHost = vi.fn()
        const render = createSlashMenuBridgeRender({
            postToHost,
            newRequestId: () => 'req-3',
            exitSuggestion: vi.fn(),
        })
        const handlers = render()
        handlers.onStart?.(makeProps() as never)
        postToHost.mockClear()

        const event = {
            key: 'ArrowDown',
            preventDefault: vi.fn(),
        } as unknown as KeyboardEvent
        const consumed = handlers.onKeyDown?.({
            view: {} as never,
            event,
            range: { from: 0, to: 1 },
        })
        expect(consumed).toBe(true)
        const msg = postToHost.mock.calls[0]?.[0] as {
            type: string
            payload: { selectedIndex: number }
        }
        expect(msg.type).toBe('popover-update')
        expect(msg.payload.selectedIndex).toBe(1)
    })

    it('wraps selectedIndex on ArrowUp at the top of the list', () => {
        const postToHost = vi.fn()
        const render = createSlashMenuBridgeRender({
            postToHost,
            newRequestId: () => 'req-4',
            exitSuggestion: vi.fn(),
        })
        const handlers = render()
        handlers.onStart?.(makeProps() as never)
        postToHost.mockClear()
        const event = { key: 'ArrowUp', preventDefault: vi.fn() } as unknown as KeyboardEvent
        handlers.onKeyDown?.({ view: {} as never, event, range: { from: 0, to: 1 } })
        const msg = postToHost.mock.calls[0]?.[0] as { payload: { selectedIndex: number } }
        // From 0, ArrowUp wraps to length-1 = 2 in a 3-item list.
        expect(msg.payload.selectedIndex).toBe(2)
    })

    it('Enter invokes command with the selected item', () => {
        const command = vi.fn()
        const render = createSlashMenuBridgeRender({
            postToHost: vi.fn(),
            newRequestId: () => 'req-5',
            exitSuggestion: vi.fn(),
        })
        const handlers = render()
        handlers.onStart?.(makeProps({ command }) as never)
        const event = { key: 'Enter', preventDefault: vi.fn() } as unknown as KeyboardEvent
        const consumed = handlers.onKeyDown?.({
            view: {} as never,
            event,
            range: { from: 0, to: 1 },
        })
        expect(consumed).toBe(true)
        expect(command).toHaveBeenCalledTimes(1)
        // Selected index starts at 0 → first command from the props
        // (heading-1).
        expect((command.mock.calls[0]?.[0] as SlashMenuCommand).id).toBe('heading-1')
    })

    it('Escape calls exitSuggestion to dismiss the trigger', () => {
        const exitSuggestionStub = vi.fn()
        const render = createSlashMenuBridgeRender({
            postToHost: vi.fn(),
            newRequestId: () => 'req-6',
            exitSuggestion: exitSuggestionStub,
        })
        const handlers = render()
        handlers.onStart?.(makeProps() as never)
        const event = { key: 'Escape', preventDefault: vi.fn() } as unknown as KeyboardEvent
        handlers.onKeyDown?.({ view: {} as never, event, range: { from: 0, to: 1 } })
        expect(exitSuggestionStub).toHaveBeenCalledTimes(1)
    })

    it('posts ui.popover-exited on onExit', () => {
        const postToHost = vi.fn()
        const render = createSlashMenuBridgeRender({
            postToHost,
            newRequestId: () => 'req-7',
            exitSuggestion: vi.fn(),
        })
        const handlers = render()
        handlers.onStart?.(makeProps() as never)
        postToHost.mockClear()
        handlers.onExit?.(makeProps() as never)
        const msg = postToHost.mock.calls[0]?.[0] as {
            namespace: string
            type: string
            requestId: string
        }
        expect(msg.namespace).toBe('ui')
        // The WebView -> host direction is popover-exited so it is
        // unambiguous against the (currently reserved) host -> WebView
        // popover-dismissed.
        expect(msg.type).toBe('popover-exited')
        expect(msg.requestId).toBe('req-7')
    })

    it('onExit without a live request does not post popover-exited', () => {
        // Simulates an onStart that failed early (null clientRect) so
        // the request was never opened; onExit must not post an
        // exit for a request that never existed.
        const postToHost = vi.fn()
        const render = createSlashMenuBridgeRender({
            postToHost,
            newRequestId: () => 'req-8',
            exitSuggestion: vi.fn(),
        })
        const handlers = render()
        handlers.onStart?.(makeProps({ clientRect: () => null }) as never)
        postToHost.mockClear()
        handlers.onExit?.(makeProps() as never)
        expect(postToHost).not.toHaveBeenCalled()
    })

    it('arrow keys are a no-op when no request is active', () => {
        const postToHost = vi.fn()
        const render = createSlashMenuBridgeRender({
            postToHost,
            newRequestId: () => 'req-9',
            exitSuggestion: vi.fn(),
        })
        const handlers = render()
        // Without onStart, the bridge has no active request — arrow keys
        // must not post anything.
        const event = { key: 'ArrowDown', preventDefault: vi.fn() } as unknown as KeyboardEvent
        const consumed = handlers.onKeyDown?.({
            view: {} as never,
            event,
            range: { from: 0, to: 1 },
        })
        expect(consumed).toBe(false)
        expect(postToHost).not.toHaveBeenCalled()
    })

    it('full cycle: open, navigate, select, exit, re-open with fresh requestId', () => {
        // Catches state-reset regressions: the bridge's internal
        // currentRequestId / currentItems / selectedIndex / editorView
        // refs MUST all clear on onExit so a second onStart in the same
        // session gets a clean slate and a fresh requestId.
        const postToHost = vi.fn()
        const exitSuggestionStub = vi.fn()
        const requestIds = ['req-cycle-1', 'req-cycle-2']
        const newRequestId = vi.fn(() => requestIds.shift() ?? 'unexpected')
        const command1 = vi.fn()
        const command3 = vi.fn()

        const render = createSlashMenuBridgeRender({
            postToHost,
            newRequestId,
            exitSuggestion: exitSuggestionStub,
        })
        const handlers = render()

        // 1. onStart(props1) — show-popover for req-cycle-1.
        handlers.onStart?.(makeProps({ command: command1 }) as never)
        expect(postToHost).toHaveBeenCalledTimes(1)
        const showMsg = postToHost.mock.calls[0]?.[0] as {
            type: string
            requestId: string
            payload: { kind: string }
        }
        expect(showMsg.type).toBe('show-popover')
        expect(showMsg.requestId).toBe('req-cycle-1')
        expect(showMsg.payload.kind).toBe('slash-menu')

        // 2. onUpdate(props2) — popover-update preserves req-cycle-1.
        postToHost.mockClear()
        handlers.onUpdate?.(
            makeProps({
                command: command1,
                items: SLASH_MENU_COMMANDS.filter(c => c.id.startsWith('heading')),
                query: 'h',
            }) as never
        )
        const updateMsg = postToHost.mock.calls[0]?.[0] as {
            type: string
            requestId: string
            payload: { query: string }
        }
        expect(updateMsg.type).toBe('popover-update')
        expect(updateMsg.requestId).toBe('req-cycle-1')
        expect(updateMsg.payload.query).toBe('h')

        // 3. ArrowDown bumps selectedIndex on the same requestId.
        postToHost.mockClear()
        const arrowEvent = {
            key: 'ArrowDown',
            preventDefault: vi.fn(),
        } as unknown as KeyboardEvent
        handlers.onKeyDown?.({ view: {} as never, event: arrowEvent, range: { from: 0, to: 1 } })
        const arrowMsg = postToHost.mock.calls[0]?.[0] as {
            requestId: string
            payload: { selectedIndex: number }
        }
        expect(arrowMsg.requestId).toBe('req-cycle-1')
        expect(arrowMsg.payload.selectedIndex).toBe(1)

        // 4. Enter applies the selected command. The bridge's
        //    exitSuggestion is invoked by the suggestion plugin (not
        //    us), so we don't assert it here — only that command1 ran.
        postToHost.mockClear()
        const enterEvent = {
            key: 'Enter',
            preventDefault: vi.fn(),
        } as unknown as KeyboardEvent
        handlers.onKeyDown?.({ view: {} as never, event: enterEvent, range: { from: 0, to: 1 } })
        expect(command1).toHaveBeenCalledTimes(1)
        // After Enter (which doesn't post anything itself), the next
        // life-cycle step is onExit fired by the suggestion plugin
        // tearing the trigger down.

        // 5. onExit — popover-exited posted for req-cycle-1; internal
        //    state must reset so the next onStart starts clean.
        postToHost.mockClear()
        handlers.onExit?.(makeProps() as never)
        const exitMsg = postToHost.mock.calls[0]?.[0] as {
            type: string
            requestId: string
        }
        expect(exitMsg.type).toBe('popover-exited')
        expect(exitMsg.requestId).toBe('req-cycle-1')

        // 6. onStart(props3) — a brand-new trigger. requestId MUST be
        //    fresh (req-cycle-2, not req-cycle-1). The new show-popover
        //    must reflect the new items / query, not the previous
        //    cycle's filter state.
        postToHost.mockClear()
        handlers.onStart?.(
            makeProps({
                command: command3,
                items: SLASH_MENU_COMMANDS.filter(c => c.id === 'image'),
                query: 'i',
            }) as never
        )
        const reopenMsg = postToHost.mock.calls[0]?.[0] as {
            type: string
            requestId: string
            payload: {
                payload: {
                    selectedIndex: number
                    items: { id: string }[]
                    query: string
                }
            }
        }
        expect(reopenMsg.type).toBe('show-popover')
        expect(reopenMsg.requestId).toBe('req-cycle-2')
        // selectedIndex reset to 0 even though the previous cycle
        // pushed it to 1.
        expect(reopenMsg.payload.payload.selectedIndex).toBe(0)
        // The new items and query are the ones from props3, not the
        // stale filter from cycle 1.
        expect(reopenMsg.payload.payload.items.map(i => i.id)).toEqual(['image'])
        expect(reopenMsg.payload.payload.query).toBe('i')

        // 7. Sanity: an Enter in cycle 2 invokes command3, NOT command1
        //    (which would mean the stale closure leaked across cycles).
        const enterEvent2 = {
            key: 'Enter',
            preventDefault: vi.fn(),
        } as unknown as KeyboardEvent
        handlers.onKeyDown?.({
            view: {} as never,
            event: enterEvent2,
            range: { from: 0, to: 1 },
        })
        expect(command3).toHaveBeenCalledTimes(1)
        expect(command1).toHaveBeenCalledTimes(1) // no additional calls
        const picked = command3.mock.calls[0]?.[0] as SlashMenuCommand
        expect(picked.id).toBe('image')
    })
})
