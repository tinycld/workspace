import { createContext, useContext } from 'react'
import type { FindReplaceController } from './find-replace-controller'

// Context that publishes the FindReplaceController for the document
// editor mounted by the screen, so the FindReplaceBar can drive the
// find/replace plugin (or its native WebView equivalent) without
// importing the editor hook directly. The provider is mounted by
// screens/[id].tsx around the document tree; the consumer is
// FindReplaceBar + useFindReplaceShortcuts.
//
// The controller abstracts the platform: on web it wraps the in-
// process Tiptap editor's state + dispatch; on native it posts
// commands to the WebView and reads observable state from a mirror
// store fed by the WebView's broadcasts. Either way, the bar talks
// to the same surface.
//
// `null` means "no editor mounted" (web variant before tiptap inits,
// or native before the WebView's first broadcast). The bar should
// treat that as "editor not ready" and disable its action buttons.
//
// The context name and exported hook keep their legacy names
// (FindReplaceEditorContext / useFindReplaceEditor) for compatibility
// with existing consumers — the type underneath is now
// FindReplaceController. A future cleanup pass can rename.
export const FindReplaceEditorContext = createContext<FindReplaceController | null>(null)

export function useFindReplaceEditor(): FindReplaceController | null {
    return useContext(FindReplaceEditorContext)
}
