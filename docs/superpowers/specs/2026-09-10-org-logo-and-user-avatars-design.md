# Organization Logo and Customizable User Avatars

**Date:** 2026-09-10
**Status:** Approved, ready for planning

## Summary

Two related capabilities, shipped as one feature because they share the same
machinery:

1. An owner or admin can upload a **logo for the organization**, replacing the
   name-initials circle that appears in the package rail, user menu, and more
   drawer.
2. A user can **customize the circle that represents them** throughout the app
   — upload a photo, pick an emoji, or choose the background color — and that
   circle appears everywhere their identity shows: boards assignees and
   reactions, contacts, mail recipients, drive sharing, members lists.

Prerequisite to both: the app currently has **four independent circle
renderers** that duplicate each other. They collapse into one `Avatar`
primitive first, so a stored avatar renders identically everywhere rather than
being honored by one renderer and silently ignored by three.

## Current state

- `users.avatar` already exists as a PocketBase file field and is **entirely
  unused** — nothing reads or writes it.
- There is no `orgs` collection. Branding is a name served unauthenticated from
  `/api/org-info`, reading `Settings().Meta.AppName`. `OrgLogo.tsx` documents
  that uploaded logos "went away with the `orgs` collection".
- `system_settings` is a key/value **text** store with admin-only read — it
  cannot hold a file, and the logo must be world-readable for pre-login screens.
- Four circle renderers exist, described below.

## The four renderers

|                    | `NameAvatar`         | `MemberAvatar`                | `PresenceAvatars` inner | `CardWatchers` inner |
| ------------------ | -------------------- | ----------------------------- | ----------------------- | -------------------- |
| Shape              | circle               | squircle (`r = size*0.32`)    | circle                  | circle               |
| Initials           | 1 letter, first name | 2 letters, name-or-email      | 1 letter                | 1 letter             |
| Color source       | hashed id → solid    | hashed email → pastel pairs   | awareness color         | awareness color      |
| Text color         | white                | paired dark tone              | white                   | white                |
| Border             | none                 | none                          | `border-background`     | `border-2 border-card` |
| Stacking           | none                 | none                          | `-size/3` + `+N`        | `-6px` + `+N`        |
| Shows stored photo | **yes**              | **yes**                       | no (transient)          | no (transient)       |

Call sites: `NameAvatar` ~20 across boards, contacts, mail, drive;
`MemberAvatar` 4 across core and calendar; `PresenceAvatars` 2 (boards, text);
`CardWatchers` 1 (boards, internal).

## Architecture

### `<Avatar>` — the single circle renderer

`tinycld/core/components/Avatar.tsx`

```ts
interface AvatarProps {
    name: string
    email?: string
    size?: number
    colorKey?: string           // stable id; falls back to email, then name
    avatar?: { fileUrl: string; crop?: CropRect }
    emoji?: string
    color?: string              // explicit override — presence passes awareness color
    palette?: 'solid' | 'soft'  // default 'solid'
    shape?: 'circle' | 'squircle'
    ring?: 'none' | 'background' | 'card'
    dimmed?: boolean
}
```

Render precedence: **image → emoji → initials**. `avatar_color` (or the hashed
fallback) is the background for the emoji and initials cases. The crop
transform is applied here, in one place, so every circle honors a user's
framing identically.

Initials are **always two letters**, via a shared `resolveInitials(name, email)`
promoted from `MemberAvatar` into `core/lib/avatar.ts`. This is an intentional
visual change at the ~20 former `NameAvatar` sites; it also gives single-name
and email-only users real initials instead of `?`.

### `<AvatarStack>`

Takes `items`, `max`, `size`, `ring`. Owns the overlap offset and the `+N`
overflow badge. Both presence renderers collapse into it.

### `core/lib/avatar.ts` — pure, unit-tested helpers

- `resolveInitials(name, email)` — two-letter initials with email-local parsing
- `avatarColor(key)` — existing deterministic palette mapping, moved here
- `clampCrop(rect)` — prevents panning the image away from the circle
- `cropToTransform(rect, size)` — rect → the translate/scale `Avatar` applies
- the inverse, for restoring a saved rect into the cropper

`Avatar` and `AvatarCropper` **must** agree exactly or the crop preview lies
about the result, so this math lives apart from both and is tested directly.

### Migration of the four renderers

- **`NameAvatar`** — deleted. Call sites move to `Avatar`.
- **`MemberAvatar`** — deleted. Call sites become
  `<Avatar palette="soft" shape="squircle" />`.
- **`PresenceAvatars`** — keeps its name and public interface (awareness parsing
  is its real job; 2 call sites depend on it). Its inner circle and stacking are
  replaced by `AvatarStack` + `<Avatar color={peer.color} ring="background" />`.
- **`CardWatchers`** — stays in boards (board-specific presence) but renders via
  `AvatarStack` with `ring="card"`.

**Preserved distinctions**, now explicit props rather than duplicated code: the
squircle + pastel `soft` palette in Members/Calendar sharing, and presence
circles taking their color from awareness while never showing a stored photo. A
watcher must not read as an assignee — that seam is load-bearing.

## Data model

### `users` (existing collection, new migration)

| Field          | Type        | Notes                                              |
| -------------- | ----------- | -------------------------------------------------- |
| `avatar`       | file        | **already exists**, currently unused                |
| `avatar_crop`  | text (JSON) | `{"x":0.5,"y":0.42,"zoom":1.8}`; absent = center-cover |
| `avatar_color` | text        | palette slug; empty = today's hashed-from-id color  |
| `avatar_emoji` | text        | single emoji; empty = initials                      |

Readable by any authenticated user — the existing `users` list/view rule already
allows this (`1800000002_users_allow_org_member_view.js`). Writable only by the
record owner.

### `org_branding` (new core collection)

| Field       | Type        |
| ----------- | ----------- |
| `logo`      | file        |
| `logo_crop` | text (JSON) |

Single row. `listRule`/`viewRule` public (`""`) because pre-login screens render
it; `createRule`/`updateRule` owner-or-admin, matching how `system_settings` is
gated.

**Why a new collection rather than `system_settings`:** that collection is
key/value *text* with admin-only read. The logo must be world-readable, so
reusing it would require a Go proxy endpoint for the bytes anyway.

**Core isolation:** `org_branding` is core-owned deployment branding and names
no package, so it sits cleanly inside `check:core-isolation`.

### `/api/org-info`

Gains `logoUrl` and `logoCrop` alongside the existing `name`, so `DocumentTitle`,
the login screen, and `OrgLogo` render branding pre-auth from the single already-
cached fetch.

## Cropping

**Decision: store the crop rectangle; never rasterize.** The uploaded image is
stored as-is (after a downscale on pick) and the framing is four normalized
numbers applied at render time.

Rejected alternatives:

- *Rasterize on the client* — small files and dumb-fast rendering, but two
  divergent implementations (canvas on web, a new native dependency), and the
  crop becomes destructive: re-cropping means re-uploading.
- *Rasterize on the server* — one implementation and the smallest files, but it
  puts image processing in core for a cosmetic feature, behind an endpoint that
  needs its own auth gating and rate limiting.
- *Native `allowsEditing` only* — nearly free, but it is a no-op on web, and web
  is the majority of users. Rejected explicitly for that reason.

Storing the rect keeps **one shared render path across web and native** and
makes the crop re-editable forever.

### `<AvatarCropper>`

A square viewport with a circular mask overlay; the image pans and pinch/scroll-
zooms beneath it. A zoom slider is the accessible fallback for pointer users
without a trackpad.

Built on `react-native-gesture-handler` + `react-native-reanimated` — both
already pinned and already used by core's drawer, sheet, and swipe primitives,
so **no new dependency on either platform**. Gestures run on the UI thread via
worklets; on commit the shared values are read once and normalized into
`{x, y, zoom}`.

### Downscale on pick

Before upload, cap the longest edge at **1024px** and re-encode. Web uses an
offscreen `<canvas>`; native passes `quality` to `expo-image-picker` plus a
resize. This is what makes "store the original" affordable — a 4MB phone photo
lands around 150KB. A server-side max file size on the field is the backstop.

**Encoding:** user avatars re-encode to JPEG (q≈0.85) — they are photos, and
the circle mask makes transparency meaningless. **Org logos preserve PNG**
(and its alpha channel) when the source is a PNG, because a transparent
wordmark on a light-or-dark background is the common case for branding;
a JPEG re-encode would matte it onto white and break dark mode.

## Upload and serving

**Upload.** File *bytes* go through `uploadRecordWithFile` from
`core/file-viewer/upload-file.ts` — the sanctioned pbtsdb bypass for bytes only.
Crop, color, and emoji are ordinary field writes through `useMutation` +
pbtsdb.

**User avatars.** Reuse the existing `useFileToken()` — it already caches one
`?token=` per session for 55 minutes and dedupes across every consumer, which is
exactly the shape avatars need (dozens of circles on one board). A new
`useAvatarUrl(user)` builds the URL via `pb.files.getURL` with `?thumb=256`, so
a single cached bitmap serves an 18px watcher and a 96px settings preview.
Because the token is stable for 55 minutes, the browser's URL-keyed HTTP cache
actually hits.

**Org logo.** `org_branding`'s public viewRule means no token is required —
which is the whole reason it is a separate collection.

## Settings UI

**Personal Settings → Profile** gains an avatar row: the current circle at 96px
with *Upload photo* / *Choose emoji* / *Remove*, plus the 8-swatch color picker.
The emoji picker is the existing `@tinycld/core/ui/emoji-picker`; the color
picker is modeled on the `ColorThemePicker` already in that screen. Upload opens
the cropper; an existing photo offers *Reposition*.

**Settings → Organization** (owner/admin only) gets the same control for the
logo, minus emoji — an org falls back to its name's initials, as `OrgLogo` does
today.

## Testing

- **Unit:** `resolveInitials` (full names, single names, email locals, empty),
  `avatarColor` stability across name edits, `clampCrop` / `cropToTransform`
  round-trips, and `Avatar`'s image → emoji → initials precedence.
- **Parity:** snapshot each `Avatar` variant so the four-renderer collapse is
  verifiable as a no-op *before* any behavior changes land.
- **E2E:** upload a photo through the UI in Personal Settings and assert the
  circle renders it — driving the real form through `useMutation`, never a raw
  PocketBase write.
- Update the stale comment at `boards/tests/e2e/keyboard-shortcuts.spec.ts:481`
  ("NameAvatar shows ONE letter"). The assertion itself targets the testID and
  still holds.

## Help

Core owns both topics, in `tinycld/core/help/`: one on personalizing your
avatar, one on organization branding. Declared via core's manifest, then
`pnpm run packages:generate`. Both are user-facing features, so per CLAUDE.md
neither is done without its topic. Website docs to be offered separately.

## Rollout

One branch — `feat/org-and-user-avatars` — with the **same name in every repo**
so package builds resolve core. Core merges first, packages follow.

| Repo       | Change                                                         |
| ---------- | -------------------------------------------------------------- |
| `tinycld`  | `Avatar`, `AvatarStack`, `AvatarCropper`, `lib/avatar.ts`, migrations, `/api/org-info`, settings UI, help |
| `boards`   | ~12 call sites, `CardWatchers`, e2e comment                      |
| `contacts` | `ContactAvatar` re-export + directory call site                  |
| `mail`     | 2 call sites                                                     |
| `drive`    | 5 call sites                                                     |
| `calendar` | 2 `soft`-variant call sites                                      |

`text` needs no change — it uses `PresenceAvatars`, whose public interface is
unchanged.

**Sequencing within the branch:** the primitives land with pure-presentation
parity and snapshot tests first, then the four renderers migrate, and only then
are the stored-avatar fields wired in. The refactor is verifiable as a no-op
before any behavior changes.

## Out of scope

- Gravatar or other external avatar sources.
- Per-package avatar overrides (one identity, everywhere).
- Animated avatars (GIF/APNG); uploads are re-encoded to a still image.
- Presence circles adopting `avatar_color` or stored photos — deliberately
  distinct, as noted above.
