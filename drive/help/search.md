---
title: Searching Drive
summary: Full-text search across names, descriptions, and file contents
tags: [search, find, fts]
order: 100
---

## To search

The toolbar's search box (top of every Drive view) searches your org's files. Type and matches appear as you type — no Enter required.

The search runs across:

- **File names** — including the extension.
- **Descriptions** — the free-text field on the Info panel.
- **File contents** — extracted text from the file body. PDFs, documents, spreadsheets, and many other formats have their text indexed when uploaded, so searching for a word inside a document finds the file.

Folders are searched by name only.

## Where search looks

The search scope is your current Drive view:

- In **My Files** — searches everything you can access in this org, including files shared with you.
- In **Shared with me**, **Recent**, **Starred**, **Trash** — searches only within that section.

The placeholder text in the search box reflects the current scope (e.g. "Search in Files").

## Indexing latency

Names and descriptions are searchable immediately. **Content** is indexed asynchronously on the server — for a freshly-uploaded large file, the content might not be searchable for a few seconds while extraction runs. Plain-text files index almost instantly; PDFs and complex documents take longer.

If you uploaded a file and can't find a word you know is in it, give it a moment and search again.

## Quoting and special characters

Multi-word searches treat each word as a separate term — all terms must match. To search for an exact phrase, wrap it in double quotes: `"quarterly revenue"`.

Special characters (`:`, `*`, `^`, `{`, `}`, `(`, `)`, `[`, `]`, `~`, `-`) are stripped from the query, so `q1-report` is treated the same as `q1 report`.

## Clearing the search

Empty the search box (or click the **×** that appears while typing) to return to the regular folder view.

## See also

- [Getting started](help://drive:getting-started)
- [Files](help://drive:files)
