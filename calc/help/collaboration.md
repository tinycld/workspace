---
title: Working with others in real time
summary: Live cursors, selections, and concurrent editing
tags: [collaboration, presence, realtime]
order: 130
---

## Real-time editing

Two or more people opening the same workbook see each other's changes immediately. There's no "save" button — every keystroke is broadcast to everyone else in the room and to the server.

## Presence indicators

For each other person in the workbook you'll see:

- **A colored cursor** at the cell they're currently selecting.
- **A colored selection border** for any range they've drag-selected.
- **An "editing" badge** on a cell when someone has it open for editing (so you don't overwrite each other mid-keystroke).
- **An avatar strip** in the top right showing everyone currently in the workbook. Hover an avatar to see their name and jump to where they are.

Each collaborator is assigned a stable color for the duration of the session.

## Concurrent edits

When two people change different cells, both edits land. When two people change the *same* cell at the same time, Calc resolves the conflict using a CRDT — both writes are kept, with the later one winning by timestamp. In practice this is rarely visible because the "editing" badge discourages people from editing the same cell at once.

## What survives a disconnect

Your edits are persisted continuously, not just on save:

- **The xlsx blob in Drive** is updated every few seconds while you edit.
- **A write-ahead log** captures every change before it's even applied — so even if the server crashes between saves, no edits are lost when it comes back.

If you lose your network, edits made while offline are queued and replay as soon as you reconnect.

## Granting access

Access to a workbook is controlled by Drive's share settings. Open **File → Share** (or share the file from Drive) to add collaborators. See [Drive sharing](help://drive:sharing) for the full model.

## See also

- [Comments](help://calc:comments)
- [Drive sharing](help://drive:sharing)
