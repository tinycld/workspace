import {
    BlockquoteBridge,
    BoldBridge,
    BulletListBridge,
    CoreBridge,
    DropCursorBridge,
    HardBreakBridge,
    HistoryBridge,
    ItalicBridge,
    LinkBridge,
    OrderedListBridge,
    PlaceholderBridge,
    RichText,
    UnderlineBridge,
    useBridgeState,
    useEditorBridge,
} from '@10play/tentap-editor'
import type { EditorCommands, EditorHandle, EditorResult, EditorToolbarState } from '@tinycld/core/lib/editor/types'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useMemo, useRef } from 'react'
import { View } from 'react-native'

function buildEditorCSS(colors: { bg: string; fg: string; placeholder: string; primary: string }) {
    return `
        * {
            background-color: ${colors.bg};
            color: ${colors.fg};
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        }
        .ProseMirror {
            padding: 0;
            min-height: 100%;
            font-size: 14px;
            line-height: 1.5;
        }
        .ProseMirror:focus {
            outline: none;
        }
        .is-editor-empty:first-child::before {
            color: ${colors.placeholder};
            content: attr(data-placeholder);
            float: left;
            height: 0;
            pointer-events: none;
        }
        blockquote {
            border-left: 3px solid ${colors.placeholder};
            padding-left: 1rem;
            margin-left: 0;
        }
        a {
            color: ${colors.primary};
            text-decoration: underline;
        }
        ul, ol {
            padding-left: 1.5rem;
        }
    `
}

const baseBridgeExtensions = [
    BoldBridge,
    ItalicBridge,
    UnderlineBridge,
    BulletListBridge,
    OrderedListBridge,
    BlockquoteBridge,
    LinkBridge,
    HistoryBridge,
    HardBreakBridge,
    DropCursorBridge,
]

interface UseMailEditorOptions {
    initialContent?: string
    placeholder?: string
    autofocus?: boolean
}

export function useMailEditor(options: UseMailEditorOptions = {}): EditorResult {
    const bgColor = useThemeColor('background')
    const fgColor = useThemeColor('foreground')
    const placeholderColor = useThemeColor('field-placeholder')
    const primaryColor = useThemeColor('primary')
    const placeholder = options.placeholder ?? ''

    const bridgeExtensions = useMemo(() => {
        const css = buildEditorCSS({
            bg: bgColor,
            fg: fgColor,
            placeholder: placeholderColor,
            primary: primaryColor,
        })
        return [
            CoreBridge.configureCSS(css),
            ...baseBridgeExtensions,
            PlaceholderBridge.configureExtension({ placeholder }),
        ]
    }, [bgColor, fgColor, placeholderColor, primaryColor, placeholder])

    const editorTheme = useMemo(() => ({ webview: { backgroundColor: bgColor } }), [bgColor])

    const liveBridge = useEditorBridge({
        initialContent: options.initialContent,
        bridgeExtensions,
        theme: editorTheme,
        autofocus: options.autofocus ?? false,
        avoidIosKeyboard: true,
    })

    // useEditorBridge returns a fresh wrapper object every render even though
    // its underlying refs (webviewRef, state subscriptions) are stable. If we
    // pass that fresh object to <RichText> the webview remounts on every
    // re-render, which steals focus on every keystroke. Pin the first wrapper
    // so RichText always sees the same identity; the underlying refs route
    // commands and state subscriptions correctly regardless.
    const bridgeRef = useRef(liveBridge)
    const bridge = bridgeRef.current

    const bridgeState = useBridgeState(bridge)

    const editor: EditorHandle = useMemo(
        () => ({
            getHTML: () => bridge.getHTML(),
            getText: () => bridge.getText(),
            setContent: (html: string) => bridge.setContent(html),
            focus: (position?: 'start' | 'end') => bridge.focus(position ?? 'end'),
            clear: () => bridge.setContent(''),
            // TenTap on its own doesn't expose a selection query; this
            // path will only get wired if mail adopts useWebViewEditor
            // and the in-WebView app responds to {app,getSelection,...}
            // messages. Awareness cursors live in @tinycld/text, not
            // mail, so null is acceptable here in v1.
            getSelection: () => Promise.resolve(null),
        }),
        [bridge]
    )

    const commands: EditorCommands = useMemo(
        () => ({
            toggleBold: () => bridge.toggleBold(),
            toggleItalic: () => bridge.toggleItalic(),
            toggleUnderline: () => bridge.toggleUnderline(),
            toggleBulletList: () => bridge.toggleBulletList(),
            toggleOrderedList: () => bridge.toggleOrderedList(),
            toggleBlockquote: () => bridge.toggleBlockquote(),
            toggleHeading: (level: number) => bridge.toggleHeading(level as 1 | 2 | 3 | 4 | 5 | 6),
            setLink: (url: string) => bridge.setLink(url),
            removeLink: () => bridge.setLink(''),
            undo: () => bridge.undo(),
            redo: () => bridge.redo(),
        }),
        [bridge]
    )

    const toolbarState: EditorToolbarState = {
        isBoldActive: bridgeState.isBoldActive,
        isItalicActive: bridgeState.isItalicActive,
        isUnderlineActive: bridgeState.isUnderlineActive,
        isBulletListActive: bridgeState.isBulletListActive,
        isOrderedListActive: bridgeState.isOrderedListActive,
        isBlockquoteActive: bridgeState.isBlockquoteActive,
        isLinkActive: bridgeState.isLinkActive,
        currentLink: bridgeState.activeLink ?? null,
    }

    const EditorComponent = useMemo(
        () =>
            function MailEditorContent() {
                return (
                    <View className="flex-1 min-h-[100px]">
                        <RichText editor={bridge} scrollEnabled={false} />
                    </View>
                )
            },
        [bridge]
    )

    return { editor, EditorComponent, commands, toolbarState }
}

export function setContentWhenReady(editor: EditorHandle, content: string): () => void {
    editor.setContent(content)
    return () => {}
}
