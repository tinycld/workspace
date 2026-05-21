---
title: Comments on mobile
summary: How comments behave on iOS and Android
tags: [comments, mobile]
order: 30
---

The full comment system is available on iOS and Android — threads, replies, resolving, and the side drawer all work the same as they do on the web. There are a few small differences in how you interact with the editor surface itself.

## To add a comment

1. Select the text you want to anchor the comment to. (Long-press to start the selection, then drag the handles.)
2. Tap the **+ comment** action in the toolbar that appears above the selection.
3. The compose modal slides up. Type the comment body. Type **@** to insert a mention — the suggestion list filters as you keep typing.
4. Tap **Post**.

The selected text is now marked with the standard comment underline, and a new thread appears in the comment drawer.

## To open and reply to threads

Open the drawer with the comment icon in the document header. Threads are grouped by their anchor; tap a thread to expand it. Tap the reply field and type to add a reply.

Tapping any marked text in the editor scrolls the drawer to the matching thread.

## To resolve a thread

Open the thread in the drawer and tap **Resolve**. Resolved threads are hidden by default. Toggle **Show resolved** in the drawer header to see them again.

## Differences from desktop

- **In-editor `@-mention autocomplete is web-only.** When typing in the editor surface itself on mobile, the **@** character is just a literal character — it does not pop a suggestion list inside the document. (Inside the comment compose modal, mention suggestions work as expected.)
- The desktop editor has a hover-highlight that fades the comment underline as your cursor approaches. On mobile, taps are discrete events, so the underline stays at full opacity at all times.

Aside from those, the marking model, anchor preservation across edits, and resolve semantics are identical across platforms.
