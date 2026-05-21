---
title: Mounting Drive as a network folder
summary: Connect to your Drive over WebDAV from macOS, Windows, or Linux
tags: [webdav, mount, network, finder, explorer]
order: 110
---

## What WebDAV does

WebDAV lets you connect to your Drive from your operating system's native file manager — Finder on macOS, Explorer on Windows, Files / Nautilus on Linux. Once mounted, your Drive looks and behaves like any other network folder: drag files in to upload, drag files out to download, double-click to open in the native app for that type.

This is the same data you see in the web UI. Edits made through WebDAV show up in the web UI in real time, and vice versa.

## The mount URL

The WebDAV endpoint is at `/drive/` on your TinyCld instance. For example:

```
https://your-instance.tinycld.app/drive/
```

At the root, you'll see one folder per organization you belong to. Open an org's folder to see that org's Drive.

## Signing in

WebDAV uses HTTP Basic auth. When your file manager prompts for credentials, use your TinyCld email and password — the same ones you use to sign in on the web.

## Mounting on macOS

1. Open **Finder**.
2. Choose **Go → Connect to Server…** (or press **⌘K**).
3. Enter the WebDAV URL (e.g. `https://your-instance.tinycld.app/drive/`).
4. Click **Connect**.
5. Choose **Registered User** and enter your email and password.

The Drive appears under **Locations** in the Finder sidebar. macOS remembers the connection so you can reconnect from the same dialog.

## Mounting on Windows

1. Open **File Explorer**.
2. Right-click **This PC** and choose **Map network drive…**.
3. Pick a drive letter.
4. Enter the WebDAV URL.
5. Tick **Connect using different credentials** and click **Finish**.
6. Enter your email and password.

The Drive appears as a mapped network drive and reconnects on every login.

## Mounting on Linux (GNOME / Nautilus)

1. Open the **Files** app.
2. Click **Other Locations** in the sidebar.
3. In the **Connect to Server** box at the bottom, enter the URL using the `davs://` scheme:
   ```
   davs://your-instance.tinycld.app/drive/
   ```
4. Click **Connect** and enter your credentials.

KDE's Dolphin works similarly via **Network → Add Network Folder → WebFolder (webdav)**.

## What works over WebDAV

- Read files and folders.
- Upload (drag in).
- Download (drag out).
- Rename.
- Move.
- Delete (sends to [Trash](help://drive:trash)).
- Create folders.

## What doesn't work over WebDAV

- Sharing — use the web UI.
- Public links — use the web UI.
- Version history — use the web UI.
- Search across content — local OS search only indexes file *names* on a network mount.

## Troubleshooting

- **"Cannot connect" / connection times out** — verify you can reach the instance over HTTPS in a web browser. WebDAV uses the same domain and port (443).
- **"Authentication failed"** — double-check you're using your email (not username) and that your password isn't out of date.
- **macOS: very slow first listing** — macOS pre-fetches metadata for every file on the first listing of a folder. Subsequent listings are cached and fast.
- **Files appear with `.DS_Store` or `Thumbs.db`** — these are OS-generated metadata files that get written into the mount. They take real storage and count toward your quota; consider configuring your OS to skip them on network drives.

## See also

- [Uploading](help://drive:uploading)
- [Folders](help://drive:folders)
