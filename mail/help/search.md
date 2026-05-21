---
title: Searching mail
summary: Full-text and structured search across every thread you can read
tags: [search, find, advanced, fts]
order: 70
---

## To search

The search box sits at the top of the mail list. Type and matches appear as you type.

The full-text index covers:

- **Subject** lines.
- **Snippets** — the first ~200 characters of each message body.
- **Sender name and email.**
- **Recipient names and emails.**
- **Full message bodies** (HTML stripped to plain text).
- **Attachment filenames.**

Like other TinyCld search, it's **prefix-aware**: `joh` matches `john`, `johnson`, `johansson`. Multiple terms must all match somewhere in the thread.

## Advanced filters

Open the **Advanced** drop-down next to the search box for structured filters. These can be combined freely with full-text terms — search runs them through SQL `LIKE` and date predicates alongside the FTS match.

| Filter | What it does |
|---|---|
| **From** | Substring match on sender name or email |
| **To** | Substring match on To / Cc recipients |
| **Subject** | Substring match on the subject line |
| **Has attachment** | Only threads with at least one attached file |
| **Before / After** | Date range filters on message dates |
| **Has words** | All listed words must appear in the indexed text (extra AND terms) |
| **Doesn't have** | None of the listed words may appear (excluded via FTS `NOT`) |

Filters can also be typed directly into the search box using `key:value` syntax (e.g. `from:alice@example.com has:attachment`) — the Advanced panel and the typed-syntax are equivalent.

## Scope

Search is scoped to every mailbox you have access to — your personal mailbox plus every shared mailbox you're a member of. There's no per-mailbox switch yet; if you want to narrow it, combine with a `to:` filter pointing at one mailbox's primary address.

## Match highlighting

Results show a snippet from the matched message with `<mark>` highlights on the matched terms. The thread row in the result list shows the subject and a one-line preview of the match.

## What's NOT searched

- **Trashed and Spam threads** are included by default. Add a folder filter (or browse the Trash / Spam views directly) to scope.
- **Drafts** are indexed — typing a search term you wrote into a draft will find that draft.
- **Labels** — to filter by label, use the sidebar label rows, not the search box. (Combining the two narrows the result set further.)

## See also

- [Folders](help://mail:folders)
- [Labels](help://mail:labels)
