---
title: Labels
summary: Colored tags for organizing threads
tags: [labels, tags, color, organize]
order: 60
---

## What labels are

Labels are colored, named tags you can attach to threads. Unlike folders (where a thread is in exactly one), a thread can have any number of labels, and a label can be on any number of threads.

Labels are **per-user-org** — what you label as "Urgent" doesn't appear that way for other members of a shared mailbox. They use the same label system as [Contacts](help://contacts:labels), so a label called "Clients" works consistently across packages.

## Managing labels

Click the gear icon next to **Labels** in the sidebar. The label manager dialog opens:

- The list of your labels with name and color swatch.
- **Add label** — name + color picker.
- Each row has **Edit** (rename / change color) and **Delete**.

Deleting a label removes it from every thread (and every contact, etc.) that had it assigned — but doesn't delete the threads themselves.

## Assigning labels to a thread

Open the thread and click the **Labels** icon in the toolbar. A picker appears — check labels to add, uncheck to remove. Changes commit immediately.

In the list view, labels appear as small colored chips next to the subject.

## Filtering by label

Each label is a clickable row under **Labels** in the sidebar. Clicking shows only threads with that label, across every mailbox you have access to. You can select **multiple** labels at once (Cmd/Ctrl-click) — the result is the union (threads matching *any* selected label).

## Cross-package

If you have Contacts installed and create a "VIP" label, it shows up in both contact and mail label pickers. Applying it to a contact and a thread groups them under the same label, but doesn't create a link between the records — each just has its own `label_assignments` row.

## See also

- [Folders](help://mail:folders)
- [Search](help://mail:search)
- [Contacts labels](help://contacts:labels)
