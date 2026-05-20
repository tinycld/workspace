---
title: Searching contacts
summary: Finding the right person across every field
tags: [search, find, filter, fts]
order: 60
---

## To search

The search box sits at the top of the Contacts list. Type and matches appear as you type — no Enter required.

Search runs across:

- **First name**
- **Last name**
- **Email**
- **Company**
- **Phone**
- **Notes** (HTML formatting is stripped before indexing, so plain text matches work)

The search is **prefix-aware**: typing `joh` matches `john`, `johnson`, `johansson` — anything starting with `joh`. You don't need to type a complete word.

## Multiple terms

Type more than one word and every term must match somewhere in the contact. For example, `john acme` finds people whose record contains both `john` and `acme` (typically John from Acme Inc.).

Words are independent — they don't need to be in a particular order or adjacent.

## What's NOT searched

Some things aren't part of the search index:

- **Labels** — to filter by label, click the label in the sidebar.
- **Favorite flag** — to see only favorites, click **Favorites** in the sidebar.
- **Job title** — the title field is not indexed for search.
- **Deleted contacts** — soft-deleted contacts are excluded from search results. To search inside Deleted, open the Deleted view from the sidebar — its search filters client-side.

You can combine sidebar views with search: click **Favorites** then type to search only within your starred contacts. (When the search box has 2+ characters, results come from the server, scoped to non-deleted contacts; the sidebar's Favorites / label filters then narrow the result set client-side.)

## How the index stays current

The search index is updated automatically as contacts change. New contacts are searchable the moment you click Save; edits propagate within the same request. There's no manual reindex needed.

## See also

- [Labels](help://contacts:labels)
- [Favorites and deletion](help://contacts:favorites-and-deletion)
