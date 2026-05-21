import { Text, View } from 'react-native'
import { formatWordCount } from '../lib/word-count'

interface WordCountBadgeProps {
    // Live word count surfaced through the editor's toolbarState. Web
    // computes it from the in-page Tiptap editor; native receives it in
    // the WebView's stateUpdate payload. Pass null/undefined when the
    // value isn't available yet (editor not mounted, non-document
    // editor) and the badge renders nothing — matching the prior
    // behavior when no editor was provided.
    wordCount: number | null | undefined
}

// Small muted chip in the document header showing the live word count.
// The badge is now driven by prop rather than subscribing directly to a
// Tiptap editor — that subscription model didn't work on native (the
// editor lives inside the WebView, with `tiptapEditor` always null on
// the host shell). useDocumentEditor's web + native variants both
// compute `wordCount` into `toolbarState`, so consumers pass it through
// uniformly.
export function WordCountBadge({ wordCount }: WordCountBadgeProps) {
    if (wordCount == null) return null
    const wordsLabel = formatWordCount(wordCount)
    return (
        <View
            accessibilityRole="text"
            accessibilityLabel={wordsLabel}
            className="flex-row items-center gap-1.5 px-2 py-1 rounded-full"
        >
            <Text className="text-xs text-muted-foreground">{wordsLabel}</Text>
        </View>
    )
}
