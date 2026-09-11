# Organization Logo and Customizable User Avatars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an owner/admin upload an organization logo, and let every user customize the circle that represents them (photo with a re-editable crop, emoji, or color) — rendered by a single unified `Avatar` component that replaces four duplicated circle renderers.

**Architecture:** Collapse `NameAvatar`, `MemberAvatar`, `PresenceAvatars`' inner circle, and boards' `CardWatchers` circle into one `Avatar` primitive plus an `AvatarStack` wrapper in core. Store the uploaded image as-is (downscaled on pick) with the user's framing kept as a normalized `{x, y, zoom}` rectangle applied at render time — never rasterized, so one shared render path serves web and native and the crop stays re-editable. User customization lives on the existing `users` collection; org branding lives in a new public-read `org_branding` collection surfaced through `/api/org-info` for pre-login screens.

**Tech Stack:** React Native + react-native-web (Expo), TypeScript, PocketBase (Go + JS migrations), pbtsdb + TanStack DB, react-hook-form + zod, react-native-gesture-handler + react-native-reanimated, vitest (unit), Playwright (e2e), biome.

## Global Constraints

- **Branch name:** `feat/org-and-user-avatars` — the **same name in every repo** (tinycld, boards, contacts, mail, drive, calendar) so package builds resolve core. **Core merges first**, packages follow.
- **No new npm dependencies.** `react-native-gesture-handler` and `react-native-reanimated` are already pinned in `tinycld/core/package-versions.json` and already used by core's drawer/sheet/swipe primitives.
- **Both platforms.** Every feature must work on web and native. Web is the majority of users.
- **Never use `any`.** Never add `biome-ignore` comments — fix the underlying issue.
- **Never `console.*` in runtime code** — use `log` from `@tinycld/core/lib/logger` (client) or `logging.ForPackage` (Go).
- **No raw hex colors in UI** — use semantic Tailwind tokens (`text-foreground`, `bg-background`) or `useThemeColor('foreground')`. The avatar palette constants are the sole exception (they are data, not theming).
- **Biome style:** 4-space indent, single quotes, ES5 trailing commas, no superfluous semicolons. Components PascalCase, hooks camelCase `use`-prefixed, utility modules kebab-case.
- **Never bypass pbtsdb.** Reads use `useOrgLiveQuery`/`useLiveQuery`; writes use `useMutation` from `@tinycld/core/lib/mutations`. The **only** sanctioned exception is file *bytes*, via `uploadRecordWithFile` from `core/file-viewer/upload-file.ts`. This applies to tests too — e2e sets up data by driving the UI, never by raw PocketBase REST writes.
- **Avoid `useState`/`useEffect`.** Use `useForm` for forms, live queries for data, `useMutation` for writes, Zustand for shared UI state. `useState` only for genuinely local synchronous UI state.
- **Keep JSX minimal.** No complex ternaries, `.map()`, or calculations inside a return. Conditional visibility uses an `isVisible` prop that returns `null`, not `{cond && <X/>}`.
- **Migrations:** unreleased migrations may be edited in place; a released version's are immutable. New migration files go in `tinycld/core/server/pb_migrations/` with a numeric prefix above the current maximum (`2010000000_prefix_notification_urls.js`).
- **Initials text metrics are `fontSize: size * 0.42`, `fontWeight: '600'`, no `letterSpacing`** — `NameAvatar`'s original values, for EVERY palette and shape. This is a deliberate ruling (2026-09-10): the first implementation hardcoded `MemberAvatar`'s `0.36`/`700`/`letterSpacing 0.2` for all variants, which silently shrank initials ~14% and bolded them at the ~20 former `NameAvatar` sites. Standardizing on `0.42`/`600` instead changes only the 4 former `MemberAvatar` sites (Members drawer, Members screen, Calendar sharing ×2). **There are therefore TWO sanctioned visual changes in this refactor**, not one: (a) one-letter initials become two letters, and (b) the four soft-palette sites get slightly larger, lighter initials. Any other rendering difference from the deleted components is a regression.
- **Crop rect shape** (verbatim, used across every task): `{ x: number, y: number, zoom: number }` where `x`/`y` are the focal point as fractions of source dimensions in `[0,1]` and `zoom >= 1` is the scale factor relative to cover-fit. Stored as a JSON string. Absent/invalid = `{ x: 0.5, y: 0.5, zoom: 1 }` (center-cover).
- **Max upload edge:** 1024px. **JPEG quality:** 0.85. **Served thumb size:** 256.
- **Component tests use `@testing-library/react` under happy-dom**, never `@testing-library/react-native` (not installed, and adding it is forbidden). Start each component test file with `// @vitest-environment happy-dom`, import `{ cleanup, fireEvent, render }` from `@testing-library/react`, query with `container.querySelector('[testid="…"]')`, and assert on `.style` / `.textContent` / `.getAttribute()`. There is **no jest-dom**, so `toHaveStyle`, `toBeVisible`, and `toBeInTheDocument` do not exist — use plain vitest matchers. react-native-web renders RN views to DOM nodes and emits colors as `rgb(...)` and lengths as `px` strings. Reference: `tinycld/core/tests/unit/toast-placement.test.tsx`.
- **Native modules must be `vi.mock`'d** in component tests (`expo-image`, `react-native-gesture-handler`, `expo-constants`, …) — their load-time side effects crash under Node. Reference: `tinycld/core/tests/unit/about-section.test.tsx`.
- **Running checks:** from inside a member, `pnpm exec tinycld-pkg check` (biome + tsc + vitest). Go tests: `cd tinycld/core/server && go test ./...`.

---

## File Structure

**Create (core — `tinycld/core/`):**
| Path | Responsibility |
| --- | --- |
| `lib/avatar.ts` | Pure helpers: palette, `avatarColor`, `resolveInitials`, `parseCrop`, `clampCrop`, `cropToTransform`. No React. |
| `components/Avatar.tsx` | The single circle renderer. image → emoji → initials. |
| `components/AvatarStack.tsx` | Overlapping row + `+N` overflow badge. |
| `components/AvatarCropper.tsx` | Pan/zoom cropper with circular mask. |
| `lib/use-avatar-url.ts` | Builds a token-carrying `?thumb=256` URL for a user's stored avatar. |
| `lib/downscale-image.ts` + `.web.ts` | Cap longest edge at 1024, re-encode. Platform-split. |
| `lib/use-org-branding.ts` | Reads/writes the single `org_branding` row. |
| `components/settings/AvatarSection.tsx` | Personal Settings avatar controls. |
| `components/settings/OrgBrandingSection.tsx` | Org logo controls (admin). |
| `server/pb_migrations/2020000000_add_users_avatar_fields.js` | `avatar_crop`, `avatar_color`, `avatar_emoji`. |
| `server/pb_migrations/2020000001_create_org_branding.js` | New public-read collection. |
| `help/personalizing-your-avatar.md`, `help/organization-branding.md` | In-app help topics. |

**Modify (core):** `components/OrgLogo.tsx`, `components/PresenceAvatars.tsx`, `components/settings/members/MembersDrawer.tsx`, `server/coreserver/users_guard.go`, `server/coreserver/org_info.go`, `lib/pocketbase.ts` (register collection), `app/a/(app)/settings/personal.tsx`, `app/a/(app)/settings/index.tsx`, `app/a/(app)/settings/members.tsx`.

**Delete (core):** `components/NameAvatar.tsx`, `components/settings/members/MemberAvatar.tsx`.

**Modify (packages):** boards (12 render sites across 10 files + `CardWatchers` + e2e comment), drive (5), mail (2), contacts (2), calendar (2).

---

## Task 1: Pure avatar helpers

**Files:**
- Create: `tinycld/core/lib/avatar.ts`
- Create: `tinycld/core/tests/unit/avatar-helpers.test.ts`
- Delete: `tinycld/core/tests/unit/avatar-color.test.ts` (superseded; its cases move into the new file)

**Interfaces:**
- Consumes: nothing.
- Produces: `AVATAR_COLORS: readonly string[]`, `SOFT_AVATAR_PALETTE: readonly (readonly [string, string])[]`, `avatarColor(key: string): string`, `softAvatarColors(key: string): readonly [string, string]`, `resolveInitials(name: string, email?: string): string`, `type CropRect = { x: number; y: number; zoom: number }`, `DEFAULT_CROP: CropRect`, `parseCrop(raw: string | null | undefined): CropRect`, `serializeCrop(rect: CropRect): string`, `clampCrop(rect: CropRect): CropRect`, `cropToTransform(rect: CropRect, size: number): { width: number; height: number; translateX: number; translateY: number }`.

- [ ] **Step 1: Write the failing test**

Create `tinycld/core/tests/unit/avatar-helpers.test.ts`:

```ts
import {
    AVATAR_COLORS,
    avatarColor,
    clampCrop,
    cropToTransform,
    DEFAULT_CROP,
    parseCrop,
    resolveInitials,
    serializeCrop,
    softAvatarColors,
} from '@tinycld/core/lib/avatar'
import { describe, expect, it } from 'vitest'

describe('avatarColor', () => {
    it('always returns a color from the palette', () => {
        const keys = ['a', 'alice@example.com', 'rec_123', '', 'Зоя', '🙂', 'x'.repeat(500)]
        for (const key of keys) {
            expect(AVATAR_COLORS).toContain(avatarColor(key))
        }
    })

    it('is deterministic for a given key', () => {
        expect(avatarColor('rec_abc123')).toBe(avatarColor('rec_abc123'))
    })

    // Keying on a stable record id means renaming must not reshuffle the color.
    it('stays constant for the same id regardless of name changes', () => {
        const id = 'contact_42'
        expect(avatarColor(id)).toBe(avatarColor(id))
    })

    it('spreads distinct keys across more than one bucket', () => {
        const ids = Array.from({ length: 64 }, (_, i) => `contact_${i}`)
        expect(new Set(ids.map(avatarColor)).size).toBeGreaterThan(1)
    })

    it('handles empty and single-character keys without throwing', () => {
        expect(AVATAR_COLORS).toContain(avatarColor(''))
        expect(AVATAR_COLORS).toContain(avatarColor('A'))
    })
})

describe('softAvatarColors', () => {
    it('returns a [background, foreground] pair', () => {
        const [bg, fg] = softAvatarColors('alice@example.com')
        expect(bg).toMatch(/^#[0-9a-f]{6}$/i)
        expect(fg).toMatch(/^#[0-9a-f]{6}$/i)
        expect(bg).not.toBe(fg)
    })

    it('is deterministic', () => {
        expect(softAvatarColors('a@b.c')).toEqual(softAvatarColors('a@b.c'))
    })
})

describe('resolveInitials', () => {
    it('takes first and last initial of a full name', () => {
        expect(resolveInitials('Ada Lovelace')).toBe('AL')
        expect(resolveInitials('Ada Byron Lovelace')).toBe('AL')
    })

    it('takes the first two letters of a single name', () => {
        expect(resolveInitials('Prince')).toBe('PR')
    })

    it('falls back to the email when the name is blank', () => {
        expect(resolveInitials('', 'ada.lovelace@example.com')).toBe('AL')
        expect(resolveInitials('   ', 'ada_lovelace@example.com')).toBe('AL')
        expect(resolveInitials('', 'ada-lovelace@example.com')).toBe('AL')
    })

    it('uses the first two letters of an unsplittable email local part', () => {
        expect(resolveInitials('', 'ada@example.com')).toBe('AD')
    })

    it('returns ? when there is nothing to work with', () => {
        expect(resolveInitials('')).toBe('?')
        expect(resolveInitials('', '')).toBe('?')
    })

    it('uppercases and handles non-ASCII names', () => {
        expect(resolveInitials('зоя павлова')).toBe('ЗП')
    })
})

describe('parseCrop / serializeCrop', () => {
    it('round-trips a valid rect', () => {
        const rect = { x: 0.25, y: 0.75, zoom: 2 }
        expect(parseCrop(serializeCrop(rect))).toEqual(rect)
    })

    it('returns the center-cover default for absent or malformed input', () => {
        expect(parseCrop(null)).toEqual(DEFAULT_CROP)
        expect(parseCrop(undefined)).toEqual(DEFAULT_CROP)
        expect(parseCrop('')).toEqual(DEFAULT_CROP)
        expect(parseCrop('not json')).toEqual(DEFAULT_CROP)
        expect(parseCrop('{"x":"a"}')).toEqual(DEFAULT_CROP)
        expect(parseCrop('null')).toEqual(DEFAULT_CROP)
    })

    it('clamps out-of-range stored values rather than trusting them', () => {
        expect(parseCrop('{"x":5,"y":-2,"zoom":0.1}')).toEqual({ x: 1, y: 0, zoom: 1 })
    })
})

describe('clampCrop', () => {
    it('keeps an in-range rect unchanged', () => {
        const rect = { x: 0.4, y: 0.6, zoom: 1.5 }
        expect(clampCrop(rect)).toEqual(rect)
    })

    it('clamps the focal point into [0,1]', () => {
        expect(clampCrop({ x: -1, y: 2, zoom: 1 })).toEqual({ x: 0, y: 1, zoom: 1 })
    })

    it('never allows zoom below 1 — the image must always cover the circle', () => {
        expect(clampCrop({ x: 0.5, y: 0.5, zoom: 0.2 }).zoom).toBe(1)
    })

    it('caps zoom at the maximum', () => {
        expect(clampCrop({ x: 0.5, y: 0.5, zoom: 99 }).zoom).toBe(8)
    })
})

describe('cropToTransform', () => {
    it('at the default rect, fills the frame exactly and centers it', () => {
        const t = cropToTransform(DEFAULT_CROP, 100)
        expect(t.width).toBe(100)
        expect(t.height).toBe(100)
        expect(t.translateX).toBe(0)
        expect(t.translateY).toBe(0)
    })

    it('scales the image up by the zoom factor', () => {
        const t = cropToTransform({ x: 0.5, y: 0.5, zoom: 2 }, 100)
        expect(t.width).toBe(200)
        expect(t.height).toBe(200)
    })

    // Focal point right-of-center means the image slides LEFT (negative X).
    it('offsets toward the focal point', () => {
        const t = cropToTransform({ x: 1, y: 0.5, zoom: 2 }, 100)
        expect(t.translateX).toBe(-100)
        expect(t.translateY).toBe(0)
    })

    it('never leaves a gap at any zoom or focal point', () => {
        for (const zoom of [1, 1.3, 2, 5, 8]) {
            for (const x of [0, 0.5, 1]) {
                const t = cropToTransform({ x, y: x, zoom }, 100)
                expect(t.translateX).toBeLessThanOrEqual(0)
                expect(t.translateX).toBeGreaterThanOrEqual(100 - t.width)
                expect(t.translateY).toBeLessThanOrEqual(0)
                expect(t.translateY).toBeGreaterThanOrEqual(100 - t.height)
            }
        }
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tinycld/core && pnpm exec vitest run tests/unit/avatar-helpers.test.ts`
Expected: FAIL — cannot resolve `@tinycld/core/lib/avatar`.

- [ ] **Step 3: Write the implementation**

Create `tinycld/core/lib/avatar.ts`:

```ts
/**
 * Pure avatar math and formatting, deliberately free of React.
 *
 * Avatar and AvatarCropper must agree exactly on the crop transform or the
 * cropper's preview lies about the stored result, so that math lives here and
 * is tested directly rather than through either component.
 */

export const AVATAR_COLORS = [
    '#3b82f6',
    '#22c55e',
    '#a855f7',
    '#f97316',
    '#ec4899',
    '#ef4444',
    '#eab308',
    '#06b6d4',
] as const

/** [background, foreground] pairs for the `soft` palette (members, sharing). */
export const SOFT_AVATAR_PALETTE = [
    ['#e0f2fe', '#0369a1'],
    ['#dcfce7', '#047857'],
    ['#fef3c7', '#b45309'],
    ['#fce7f3', '#be185d'],
    ['#ede9fe', '#6d28d9'],
    ['#ffedd5', '#c2410c'],
    ['#cffafe', '#0e7490'],
    ['#fee2e2', '#b91c1c'],
] as const

const MAX_ZOOM = 8

function hashString(value: string): number {
    let hash = 0
    for (let i = 0; i < value.length; i++) {
        hash = (hash << 5) - hash + value.charCodeAt(i)
        hash |= 0
    }
    return Math.abs(hash)
}

/**
 * Deterministic background color for a key. Pass a stable id (not a name) so
 * editing a display name doesn't reshuffle the color.
 */
export function avatarColor(key: string): string {
    return AVATAR_COLORS[hashString(key) % AVATAR_COLORS.length] as string
}

export function softAvatarColors(key: string): readonly [string, string] {
    const pair = SOFT_AVATAR_PALETTE[hashString(key) % SOFT_AVATAR_PALETTE.length]
    return (pair ?? SOFT_AVATAR_PALETTE[0]) as readonly [string, string]
}

/**
 * Two-letter initials. Prefers first+last of a name; falls back to the email's
 * local part, which is often the only identity we have in sharing dialogs.
 */
export function resolveInitials(name: string, email?: string): string {
    const source = name.trim() || (email ?? '').trim()
    if (!source) return '?'

    const parts = source.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) {
        const first = parts[0]?.[0] ?? ''
        const last = parts[parts.length - 1]?.[0] ?? ''
        return `${first}${last}`.toUpperCase()
    }

    const atIndex = source.indexOf('@')
    if (atIndex > 0) {
        const local = source.slice(0, atIndex)
        const localParts = local.split(/[._-]/).filter(Boolean)
        if (localParts.length >= 2) {
            const a = localParts[0]?.[0] ?? ''
            const b = localParts[1]?.[0] ?? ''
            return `${a}${b}`.toUpperCase()
        }
        return local.slice(0, 2).toUpperCase()
    }

    return source.slice(0, 2).toUpperCase()
}

/**
 * Where the image sits inside the circle. `x`/`y` are the focal point as
 * fractions of the source in [0,1]; `zoom` is the scale relative to cover-fit.
 */
export interface CropRect {
    x: number
    y: number
    zoom: number
}

export const DEFAULT_CROP: CropRect = { x: 0.5, y: 0.5, zoom: 1 }

function clampNumber(value: number, min: number, max: number): number {
    if (!Number.isFinite(value)) return min
    return Math.min(max, Math.max(min, value))
}

export function clampCrop(rect: CropRect): CropRect {
    return {
        x: clampNumber(rect.x, 0, 1),
        y: clampNumber(rect.y, 0, 1),
        zoom: clampNumber(rect.zoom, 1, MAX_ZOOM),
    }
}

/**
 * Stored crops are user-supplied JSON that may predate a schema change, so
 * anything unparseable or out of range degrades to center-cover rather than
 * throwing in the middle of a list render.
 */
export function parseCrop(raw: string | null | undefined): CropRect {
    if (!raw) return DEFAULT_CROP
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return DEFAULT_CROP
    }
    if (parsed === null || typeof parsed !== 'object') return DEFAULT_CROP
    const candidate = parsed as Partial<Record<keyof CropRect, unknown>>
    if (
        typeof candidate.x !== 'number' ||
        typeof candidate.y !== 'number' ||
        typeof candidate.zoom !== 'number'
    ) {
        return DEFAULT_CROP
    }
    return clampCrop({ x: candidate.x, y: candidate.y, zoom: candidate.zoom })
}

export function serializeCrop(rect: CropRect): string {
    return JSON.stringify(clampCrop(rect))
}

/**
 * Turn a crop rect into the image box and offset to render inside a
 * `size`-square frame. The offsets are clamped so the scaled image always
 * covers the frame — a gap would show the background through the photo.
 */
export function cropToTransform(
    rect: CropRect,
    size: number
): { width: number; height: number; translateX: number; translateY: number } {
    const { x, y, zoom } = clampCrop(rect)
    const scaled = size * zoom
    const overflow = scaled - size
    return {
        width: scaled,
        height: scaled,
        translateX: -overflow * x,
        translateY: -overflow * y,
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tinycld/core && pnpm exec vitest run tests/unit/avatar-helpers.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Delete the superseded test**

```bash
rm tinycld/core/tests/unit/avatar-color.test.ts
```

Its cases now live in `avatar-helpers.test.ts`. `NameAvatar` still exports `avatarColor` at this point (deleted in Task 4), so nothing else breaks yet.

- [ ] **Step 6: Commit**

```bash
git add tinycld/core/lib/avatar.ts tinycld/core/tests/unit/avatar-helpers.test.ts
git add -u tinycld/core/tests/unit/avatar-color.test.ts
git commit -m "feat(core): add pure avatar helpers for color, initials and crop math"
```

---

## Task 2: The `Avatar` component

**Files:**
- Create: `tinycld/core/components/Avatar.tsx`
- Create: `tinycld/core/tests/unit/avatar-component.test.tsx`

**Interfaces:**
- Consumes: everything Task 1 produced from `@tinycld/core/lib/avatar`.
- Produces: `Avatar` and `AvatarProps` from `@tinycld/core/components/Avatar`, plus `type AvatarImage = { fileUrl: string; crop?: CropRect }`.

**Rendering precedence is image → emoji → initials.** `testID` defaults are load-bearing for the tests below: the root carries the passed `testID`; the image carries `${testID}-image`; emoji and initials render as `Text`.

- [ ] **Step 1: Write the failing test**

Create `tinycld/core/tests/unit/avatar-component.test.tsx`.

**Testing idiom — follow it exactly.** This repo tests components with
`@testing-library/react` under happy-dom (react-native-web renders RN views to
DOM nodes). There is **no** `@testing-library/react-native` and **no** jest-dom,
so there is no `screen`, no `getByTestId`, and no `toHaveStyle`. Query with
`container.querySelector('[testid="…"]')` and assert on `.style` /
`.textContent`. `tinycld/core/tests/unit/toast-placement.test.tsx` is the
reference example.

```tsx
// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { Avatar } from '@tinycld/core/components/Avatar'
import { afterEach, describe, expect, it, vi } from 'vitest'

// expo-image is a native module wrapper; under Node it has no value. The
// component only needs an <img>-alike that forwards testID and style.
vi.mock('expo-image', () => ({
    Image: ({ testID, style, source }: never) => {
        const props = { testID, style, source } as {
            testID?: string
            style?: Record<string, unknown>
            source?: { uri?: string }
        }
        return (
            <img
                testid={props.testID}
                src={props.source?.uri}
                alt=""
                style={props.style as never}
            />
        )
    },
}))

afterEach(cleanup)

function renderAvatar(element: React.ReactElement) {
    const { container } = render(element)
    const root = container.querySelector('[testid="av"]') as HTMLElement | null
    if (!root) throw new Error('avatar did not render')
    const image = container.querySelector('[testid="av-image"]') as HTMLElement | null
    return { root, image, container }
}

describe('Avatar precedence', () => {
    it('renders the image when one is supplied, over emoji and initials', () => {
        const { root, image } = renderAvatar(
            <Avatar
                name="Ada Lovelace"
                emoji="🦖"
                avatar={{ fileUrl: 'https://example.test/a.jpg' }}
                testID="av"
            />
        )
        expect(image).not.toBeNull()
        expect(root.textContent).not.toContain('🦖')
        expect(root.textContent).not.toContain('AL')
    })

    it('renders the emoji when there is no image', () => {
        const { root, image } = renderAvatar(<Avatar name="Ada Lovelace" emoji="🦖" testID="av" />)
        expect(image).toBeNull()
        expect(root.textContent).toContain('🦖')
        expect(root.textContent).not.toContain('AL')
    })

    it('falls back to two-letter initials', () => {
        const { root } = renderAvatar(<Avatar name="Ada Lovelace" testID="av" />)
        expect(root.textContent).toContain('AL')
    })

    it('derives initials from the email when the name is blank', () => {
        const { root } = renderAvatar(
            <Avatar name="" email="ada.lovelace@example.com" testID="av" />
        )
        expect(root.textContent).toContain('AL')
    })
})

describe('Avatar presentation', () => {
    it('is a full circle by default', () => {
        const { root } = renderAvatar(<Avatar name="Ada Lovelace" size={40} testID="av" />)
        expect(root.style.borderRadius).toBe('20px')
    })

    it('uses a squircle radius when asked', () => {
        const { root } = renderAvatar(
            <Avatar name="Ada Lovelace" size={40} shape="squircle" testID="av" />
        )
        // 40 * 0.32
        expect(root.style.borderRadius).toBe('12.8px')
    })

    it('honors an explicit color override, as presence does', () => {
        const { root } = renderAvatar(<Avatar name="Ada" color="#123456" testID="av" />)
        // react-native-web emits colors as rgb().
        expect(root.style.backgroundColor).toBe('rgb(18, 52, 86)')
    })

    it('applies the crop transform to the image', () => {
        const { image } = renderAvatar(
            <Avatar
                name="Ada"
                size={100}
                avatar={{ fileUrl: 'https://example.test/a.jpg', crop: { x: 1, y: 0.5, zoom: 2 } }}
                testID="av"
            />
        )
        if (!image) throw new Error('avatar image did not render')
        expect(image.style.width).toBe('200px')
        expect(image.style.height).toBe('200px')
        expect(image.style.transform).toContain('-100px')
    })

    it('exposes the name to assistive technology', () => {
        const { root } = renderAvatar(<Avatar name="Ada Lovelace" testID="av" />)
        expect(root.getAttribute('aria-label')).toBe('Ada Lovelace')
    })
})
```

If react-native-web emits the `testID` prop under a different attribute name
than `testid` (check a rendered node with `container.innerHTML` once), use
whatever it actually emits — match the existing `toast-placement.test.tsx`
behavior rather than changing the component to suit the test.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tinycld/core && pnpm exec vitest run tests/unit/avatar-component.test.tsx`
Expected: FAIL — cannot resolve `@tinycld/core/components/Avatar`.

- [ ] **Step 3: Write the implementation**

Create `tinycld/core/components/Avatar.tsx`:

```tsx
import {
    avatarColor,
    type CropRect,
    cropToTransform,
    DEFAULT_CROP,
    resolveInitials,
    softAvatarColors,
} from '@tinycld/core/lib/avatar'
import { Image } from 'expo-image'
import { Text, View } from 'react-native'

export interface AvatarImage {
    fileUrl: string
    crop?: CropRect
}

export interface AvatarProps {
    name: string
    email?: string
    size?: number
    /** Stable id the color derives from; falls back to email, then name. */
    colorKey?: string
    avatar?: AvatarImage
    emoji?: string
    /** Explicit background override — presence passes its awareness color. */
    color?: string
    palette?: 'solid' | 'soft'
    shape?: 'circle' | 'squircle'
    ring?: 'none' | 'background' | 'card'
    dimmed?: boolean
    testID?: string
}

const RING_CLASS = {
    none: '',
    background: 'border border-background',
    card: 'border-2 border-card',
} as const

/**
 * The one circle that represents a person or an organization.
 *
 * Renders image → emoji → initials, so a user who has uploaded a photo sees it
 * everywhere and one who hasn't still gets a stable, legible circle. Presence
 * callers pass `color` to override the identity-derived palette: a transient
 * viewer must not read as an assignee.
 */
export function Avatar({
    name,
    email,
    size = 40,
    colorKey,
    avatar,
    emoji,
    color,
    palette = 'solid',
    shape = 'circle',
    ring = 'none',
    dimmed = false,
    testID,
}: AvatarProps) {
    const key = colorKey ?? (email || name)
    const [softBg, softFg] = softAvatarColors(key)
    const backgroundColor = color ?? (palette === 'soft' ? softBg : avatarColor(key))
    const foregroundColor = palette === 'soft' && !color ? softFg : '#fff'
    const borderRadius = shape === 'circle' ? size / 2 : size * 0.32

    return (
        <View
            testID={testID}
            accessibilityRole="image"
            accessibilityLabel={name || email || 'Avatar'}
            className={`items-center justify-center overflow-hidden ${RING_CLASS[ring]}`}
            style={{
                width: size,
                height: size,
                borderRadius,
                backgroundColor,
                opacity: dimmed ? 0.55 : 1,
            }}
        >
            <AvatarContent
                avatar={avatar}
                emoji={emoji}
                name={name}
                email={email}
                size={size}
                foregroundColor={foregroundColor}
                testID={testID}
            />
        </View>
    )
}

function AvatarContent({
    avatar,
    emoji,
    name,
    email,
    size,
    foregroundColor,
    testID,
}: {
    avatar: AvatarImage | undefined
    emoji: string | undefined
    name: string
    email: string | undefined
    size: number
    foregroundColor: string
    testID: string | undefined
}) {
    if (avatar?.fileUrl) {
        const { width, height, translateX, translateY } = cropToTransform(
            avatar.crop ?? DEFAULT_CROP,
            size
        )
        return (
            <Image
                testID={testID ? `${testID}-image` : undefined}
                source={{ uri: avatar.fileUrl }}
                contentFit="cover"
                style={{
                    width,
                    height,
                    transform: [{ translateX }, { translateY }],
                }}
            />
        )
    }

    if (emoji) {
        return <Text style={{ fontSize: size * 0.52, lineHeight: size }}>{emoji}</Text>
    }

    return (
        <Text
            style={{
                color: foregroundColor,
                fontWeight: '600',
                fontSize: size * 0.42,
            }}
        >
            {resolveInitials(name, email)}
        </Text>
    )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tinycld/core && pnpm exec vitest run tests/unit/avatar-component.test.tsx`
Expected: PASS.

If `expo-image` is not resolvable under vitest, check `tinycld/vitest.config.ts` and `tests/` for the existing stub pattern (e.g. `tests/expo-clipboard-stub.ts`) and add an equivalent alias — do not switch to RN's `Image` to dodge the failure; `expo-image` is what the app ships.

- [ ] **Step 5: Commit**

```bash
git add tinycld/core/components/Avatar.tsx tinycld/core/tests/unit/avatar-component.test.tsx
git commit -m "feat(core): add unified Avatar component"
```

---

## Task 3: The `AvatarStack` component

**Files:**
- Create: `tinycld/core/components/AvatarStack.tsx`
- Create: `tinycld/core/tests/unit/avatar-stack.test.tsx`

**Interfaces:**
- Consumes: `Avatar`, `AvatarProps` (Task 2).
- Produces: `AvatarStack`, and `type AvatarStackItem = { key: string } & Omit<AvatarProps, 'size' | 'ring' | 'testID'>`.

- [ ] **Step 1: Write the failing test**

Create `tinycld/core/tests/unit/avatar-stack.test.tsx`. Same testing idiom as
Task 2 — `@testing-library/react` under happy-dom, `container.querySelector`,
no `screen`/`toHaveStyle`:

```tsx
// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { AvatarStack } from '@tinycld/core/components/AvatarStack'
import { afterEach, describe, expect, it } from 'vitest'

afterEach(cleanup)

const items = [
    { key: 'a', name: 'Ada Lovelace' },
    { key: 'b', name: 'Grace Hopper' },
    { key: 'c', name: 'Alan Turing' },
    { key: 'd', name: 'Katherine Johnson' },
    { key: 'e', name: 'Margaret Hamilton' },
]

describe('AvatarStack', () => {
    it('renders every item when under the limit', () => {
        const { container } = render(<AvatarStack items={items.slice(0, 3)} max={4} testID="stack" />)
        expect(container.textContent).toContain('AL')
        expect(container.textContent).toContain('GH')
        expect(container.textContent).toContain('AT')
        expect(container.querySelector('[testid="stack-overflow"]')).toBeNull()
    })

    it('caps at max and shows a +N badge for the remainder', () => {
        const { container } = render(<AvatarStack items={items} max={3} testID="stack" />)
        expect(container.querySelector('[testid="stack-overflow"]')).not.toBeNull()
        expect(container.textContent).toContain('+2')
        expect(container.textContent).not.toContain('KJ')
    })

    it('overlaps every avatar after the first', () => {
        const { container } = render(
            <AvatarStack items={items.slice(0, 2)} max={4} size={30} testID="stack" />
        )
        const first = container.querySelector('[testid="stack-item-0"]') as HTMLElement
        const second = container.querySelector('[testid="stack-item-1"]') as HTMLElement
        expect(first.style.marginLeft).toBe('0px')
        expect(second.style.marginLeft).toBe('-10px')
    })

    it('renders nothing when empty', () => {
        const { container } = render(<AvatarStack items={[]} max={4} testID="stack" />)
        expect(container.querySelector('[testid="stack"]')).toBeNull()
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tinycld/core && pnpm exec vitest run tests/unit/avatar-stack.test.tsx`
Expected: FAIL — cannot resolve `@tinycld/core/components/AvatarStack`.

- [ ] **Step 3: Write the implementation**

Create `tinycld/core/components/AvatarStack.tsx`:

```tsx
import { Avatar, type AvatarProps } from '@tinycld/core/components/Avatar'
import { Text, View } from 'react-native'

export type AvatarStackItem = { key: string } & Omit<AvatarProps, 'size' | 'ring' | 'testID'>

interface AvatarStackProps {
    items: readonly AvatarStackItem[]
    max?: number
    size?: number
    ring?: AvatarProps['ring']
    testID?: string
}

/**
 * An overlapping row of avatars with a "+N" badge for the remainder. Shared by
 * every stacked-identity surface (document presence, card watchers, assignees)
 * so the overlap and overflow behave identically across them.
 */
export function AvatarStack({ items, max = 4, size = 24, ring = 'none', testID }: AvatarStackProps) {
    if (items.length === 0) return null

    const visible = items.slice(0, max)
    const overflow = items.length - visible.length
    const offset = -size / 3

    return (
        <View testID={testID} className="flex-row items-center">
            {visible.map((item, index) => {
                const { key, ...avatarProps } = item
                return (
                    <View
                        key={key}
                        testID={testID ? `${testID}-item-${index}` : undefined}
                        style={{ marginLeft: index === 0 ? 0 : offset }}
                    >
                        <Avatar {...avatarProps} size={size} ring={ring} />
                    </View>
                )
            })}
            <OverflowBadge
                count={overflow}
                size={size}
                offset={offset}
                testID={testID ? `${testID}-overflow` : undefined}
            />
        </View>
    )
}

function OverflowBadge({
    count,
    size,
    offset,
    testID,
}: {
    count: number
    size: number
    offset: number
    testID: string | undefined
}) {
    if (count <= 0) return null

    return (
        <View
            testID={testID}
            className="items-center justify-center bg-surface-secondary border border-background"
            style={{
                width: size,
                height: size,
                borderRadius: size / 2,
                marginLeft: offset,
            }}
        >
            <Text className="text-foreground font-semibold" style={{ fontSize: size * 0.4 }}>
                +{count}
            </Text>
        </View>
    )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tinycld/core && pnpm exec vitest run tests/unit/avatar-stack.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tinycld/core/components/AvatarStack.tsx tinycld/core/tests/unit/avatar-stack.test.tsx
git commit -m "feat(core): add AvatarStack for overlapping avatar rows"
```

---

## Task 4: Migrate core's call sites and delete the old renderers

**Files:**
- Delete: `tinycld/core/components/NameAvatar.tsx`
- Delete: `tinycld/core/components/settings/members/MemberAvatar.tsx`
- Modify: `tinycld/core/components/PresenceAvatars.tsx`
- Modify: `tinycld/core/components/settings/members/MembersDrawer.tsx:152`
- Modify: `tinycld/app/a/(app)/settings/members.tsx:371`
- Modify: `tinycld/core/components/OrgLogo.tsx`

**Interfaces:**
- Consumes: `Avatar` (Task 2), `AvatarStack` (Task 3).
- Produces: no new exports. `PresenceAvatars` keeps its existing public signature `({ awareness, max?, size? })` — two packages depend on it.

This task is presentation-parity only: no stored avatars yet. The two intended visual changes are (a) two-letter initials where `NameAvatar` showed one, and (b) the four former `MemberAvatar` sites adopting `NameAvatar`'s slightly larger, lighter initials (`0.42`/`600`, no letter-spacing) — see Global Constraints. Everything else must render identically to the deleted components.

- [ ] **Step 1: Replace PresenceAvatars' inner circle with AvatarStack**

In `tinycld/core/components/PresenceAvatars.tsx`, delete the local `Avatar` function and its `AvatarProps` interface entirely, and replace the returned JSX of `PresenceAvatars` with:

```tsx
    return (
        <AvatarStack
            items={peers.map(peer => ({
                key: String(peer.clientID),
                name: peer.state.user.name,
                color: peer.state.user.color,
                colorKey: peer.state.user.id,
            }))}
            max={max}
            size={size}
            ring="background"
        />
    )
```

Remove the now-unused `Text` import if nothing else in the file uses it, and add:

```tsx
import { AvatarStack } from '@tinycld/core/components/AvatarStack'
```

Keep the `if (peers.length === 0) return null` guard, `parseSlot`, and `sameUser` exactly as they are — awareness parsing is this component's real job.

- [ ] **Step 2: Migrate the two `MemberAvatar` call sites in this repo**

In `tinycld/core/components/settings/members/MembersDrawer.tsx` and `tinycld/app/a/(app)/settings/members.tsx`, replace the import:

```tsx
import { Avatar } from '@tinycld/core/components/Avatar'
```

and each `<MemberAvatar name={…} email={…} size={…} dimmed={…} />` with:

```tsx
<Avatar name={…} email={…} size={…} dimmed={…} palette="soft" shape="squircle" />
```

Preserve each site's existing `size` and `dimmed` values verbatim.

- [ ] **Step 3: Point OrgLogo at Avatar**

Replace the body of `tinycld/core/components/OrgLogo.tsx`:

```tsx
import { Avatar } from '@tinycld/core/components/Avatar'
import type { ReactNode } from 'react'

interface OrgLogoProps {
    org: { id: string; name: string } | null | undefined
    size?: number
    /** Rendered when org is null/loading. Defaults to nothing. */
    fallback?: ReactNode
}

/**
 * Round avatar for the organization: the uploaded logo when one is set,
 * otherwise consistent colored initials keyed off the org name.
 */
export function OrgLogo({ org, size = 36, fallback = null }: OrgLogoProps) {
    if (!org) return <>{fallback}</>
    return <Avatar name={org.name} colorKey={org.id} size={size} />
}
```

The uploaded logo is wired in at Task 9; this step only removes the `NameAvatar` dependency.

- [ ] **Step 4: Delete the old renderers**

```bash
rm tinycld/core/components/NameAvatar.tsx
rm tinycld/core/components/settings/members/MemberAvatar.tsx
```

- [ ] **Step 5: Verify nothing in this repo still references them**

Run:

```bash
grep -rn "NameAvatar\|MemberAvatar" tinycld/core tinycld/app --include="*.tsx" --include="*.ts" | grep -v node_modules
```

Expected: no output. Sibling packages still reference `NameAvatar` and are fixed in Tasks 5–8 — that is expected at this commit, since core merges first.

- [ ] **Step 6: Pin every variant with a snapshot test**

The whole point of doing the refactor before the feature is that it should be a
no-op. Create `tinycld/core/tests/unit/avatar-variants.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { Avatar } from '@tinycld/core/components/Avatar'
import { AvatarStack } from '@tinycld/core/components/AvatarStack'
import { afterEach, describe, expect, it } from 'vitest'

afterEach(cleanup)

// One snapshot per variant the four old renderers produced. These are the
// guard against the collapse silently changing a surface nobody opened during
// review. Snapshotting innerHTML captures the rendered geometry and colors,
// which is exactly what must not drift.
describe('Avatar variants', () => {
    it('renders the solid circle (former NameAvatar)', () => {
        const { container } = render(<Avatar name="Ada Lovelace" colorKey="u1" size={40} />)
        expect(container.innerHTML).toMatchSnapshot()
    })

    it('renders the soft squircle (former MemberAvatar)', () => {
        const { container } = render(
            <Avatar
                name="Ada Lovelace"
                email="ada@example.com"
                size={40}
                palette="soft"
                shape="squircle"
            />
        )
        expect(container.innerHTML).toMatchSnapshot()
    })

    it('renders the dimmed soft squircle', () => {
        const { container } = render(
            <Avatar name="Ada Lovelace" size={40} palette="soft" shape="squircle" dimmed />
        )
        expect(container.innerHTML).toMatchSnapshot()
    })

    it('renders the presence stack (former PresenceAvatars inner)', () => {
        const { container } = render(
            <AvatarStack
                items={[
                    { key: '1', name: 'Ada Lovelace', color: '#3b82f6', colorKey: 'u1' },
                    { key: '2', name: 'Grace Hopper', color: '#22c55e', colorKey: 'u2' },
                ]}
                max={4}
                size={24}
                ring="background"
            />
        )
        expect(container.innerHTML).toMatchSnapshot()
    })

    it('renders the watcher stack with overflow (former CardWatchers)', () => {
        const { container } = render(
            <AvatarStack
                items={[
                    { key: '1', name: 'Ada Lovelace', color: '#3b82f6', colorKey: 'u1' },
                    { key: '2', name: 'Grace Hopper', color: '#22c55e', colorKey: 'u2' },
                    { key: '3', name: 'Alan Turing', color: '#a855f7', colorKey: 'u3' },
                ]}
                max={2}
                size={18}
                ring="card"
            />
        )
        expect(container.innerHTML).toMatchSnapshot()
    })
})
```

- [ ] **Step 7: Run the snapshot test and review the generated output**

Run: `cd tinycld/core && pnpm exec vitest run tests/unit/avatar-variants.test.tsx`
Expected: PASS, writing new snapshots.

Open the generated `__snapshots__` file and read it. Confirm each variant has
the size, border radius, background color, and border the old renderer
produced — a snapshot written from wrong output locks in the bug. In
particular: the soft squircle's radius must be `40 * 0.32 = 12.8`, and the
watcher stack must carry `border-2 border-card`.

- [ ] **Step 8: Run core's checks**

Run: `cd tinycld/core && pnpm exec tinycld-pkg check`
Expected: biome clean, tsc clean, vitest green.

- [ ] **Step 9: Commit**

```bash
git add -A tinycld/core tinycld/app
git commit -m "refactor(core): render every avatar through Avatar and AvatarStack"
```

---

## Task 5: Migrate boards

**Files:**
- Modify: 10 files with `<NameAvatar` in `boards/tinycld/boards/` — `components/BoardHeader.tsx:441`, `components/BoardCard.tsx:929`, `components/sharing/MemberRow.tsx:36`, `components/sharing/AddMemberDialog.tsx:231`, `components/detail/ReporterPicker.tsx:39`, `components/detail/DetailProperties.tsx:464`, `components/detail/DetailActivity.tsx:149,256`, `components/filter/FilterPanel.tsx:196,219`, `components/filter/FilterBar.tsx:186`, `components/table/CardRow.tsx:209`
- Modify: `boards/tinycld/boards/components/BoardCard.tsx` — the `CardWatchers` function (~line 750)
- Modify: `boards/tests/e2e/keyboard-shortcuts.spec.ts:481` (comment only)

**Interfaces:**
- Consumes: `Avatar`, `AvatarStack` from core (Tasks 2–3).
- Produces: nothing.

- [ ] **Step 1: Create the branch**

```bash
cd boards && git checkout -b feat/org-and-user-avatars
```

- [ ] **Step 2: Swap every NameAvatar usage**

In each of the 10 files, change the import to:

```tsx
import { Avatar } from '@tinycld/core/components/Avatar'
```

and rename each `<NameAvatar … />` element to `<Avatar … />`. **Prop names are unchanged** (`firstName`/`lastName` are the one exception — see the next step). Leave every `size`, `colorKey`, and layout wrapper exactly as it is.

- [ ] **Step 3: Collapse firstName/lastName into name**

`Avatar` takes a single `name`, not `firstName`/`lastName`. For each site, join them:

```tsx
// before
<NameAvatar firstName={user.firstName} lastName={user.lastName} size={24} colorKey={user.id} />
// after
<Avatar name={`${user.firstName} ${user.lastName ?? ''}`.trim()} size={24} colorKey={user.id} />
```

`boards/tinycld/boards/lib/board-project.ts:39` has a helper that splits a user into a first/last pair for `NameAvatar`. Check its remaining callers: if a call site now only needs the joined name, pass `user.name` directly and leave the helper alone if anything else still uses it. Do not delete a helper other code depends on.

- [ ] **Step 4: Rewrite CardWatchers on AvatarStack**

In `boards/tinycld/boards/components/BoardCard.tsx`, replace the `CardWatchers` body (keeping its doc comment, which explains why a watcher must not read as an assignee):

```tsx
function CardWatchers({ watchers, cardId }: { watchers: RemoteCardsPresence[]; cardId: string }) {
    return (
        <AvatarStack
            testID={`boards-watchers-${cardId}`}
            items={watchers.map(watcher => ({
                key: String(watcher.clientID),
                name: watcher.user.name,
                color: watcher.user.color,
                colorKey: watcher.user.id,
            }))}
            max={MAX_WATCHERS}
            size={18}
            ring="card"
        />
    )
}
```

`AvatarStack` already returns `null` when `items` is empty, so the explicit early return goes away. Add the import:

```tsx
import { AvatarStack } from '@tinycld/core/components/AvatarStack'
```

- [ ] **Step 5: Fix the stale e2e comment**

In `boards/tests/e2e/keyboard-shortcuts.spec.ts` around line 481, replace:

```ts
        // The avatar row itself, not the initial it renders: NameAvatar shows
        // ONE letter, which collides with card titles and keys and makes a
        // text assertion meaningless in both directions.
```

with:

```ts
        // The avatar row itself, not the initials it renders: initials collide
        // with card titles and keys, which makes a text assertion meaningless
        // in both directions.
```

The assertion below it targets the testID and is unchanged.

- [ ] **Step 6: Verify no stragglers**

Run: `grep -rn "NameAvatar" boards/tinycld boards/tests | grep -v node_modules`
Expected: no output.

- [ ] **Step 7: Run boards' checks**

Run: `cd boards && pnpm exec tinycld-pkg check`
Expected: biome clean, tsc clean, vitest green.

- [ ] **Step 8: Commit**

```bash
cd boards && git add -A && git commit -m "refactor: render avatars through the unified core Avatar"
```

---

## Task 6: Migrate drive and mail

**Files:**
- Modify: `drive/tinycld/drive/components/ShareDialog.tsx` (5 sites: lines ~253, ~301, ~337, ~614, plus the import)
- Modify: `mail/tinycld/mail/components/RecipientField.tsx`, `mail/tinycld/mail/components/RecipientSuggestionList.tsx`

**Interfaces:**
- Consumes: `Avatar` from core (Task 2).
- Produces: nothing.

Mail imports `NameAvatar as ContactAvatar`; keep the local alias so the JSX below doesn't churn.

- [ ] **Step 1: Create both branches**

```bash
cd drive && git checkout -b feat/org-and-user-avatars && cd ..
cd mail && git checkout -b feat/org-and-user-avatars && cd ..
```

- [ ] **Step 2: Migrate drive**

In `drive/tinycld/drive/components/ShareDialog.tsx`, change the import to `import { Avatar } from '@tinycld/core/components/Avatar'` and rename each `<NameAvatar … />` to `<Avatar … />`. Line ~614 passes `firstName`/`lastName` — join it:

```tsx
<Avatar name={`${firstName} ${lastName ?? ''}`.trim()} size={40} />
```

The other three pass `firstName={p.name || p.email}`; convert each to the two-field form so email-derived initials work:

```tsx
<Avatar name={p.name} email={p.email} size={36} />
```

- [ ] **Step 3: Migrate mail**

In both mail files, change the import to:

```tsx
import { Avatar as ContactAvatar } from '@tinycld/core/components/Avatar'
```

Leave the `<ContactAvatar … />` JSX in place, but if a site passes `firstName`, rename that prop to `name` (and pass `email` alongside when the record has one).

- [ ] **Step 4: Verify no stragglers**

Run: `grep -rn "NameAvatar" drive/tinycld mail/tinycld | grep -v node_modules`
Expected: no output.

- [ ] **Step 5: Run both packages' checks**

Run: `cd drive && pnpm exec tinycld-pkg check` then `cd mail && pnpm exec tinycld-pkg check`
Expected: both green.

- [ ] **Step 6: Commit both**

```bash
cd drive && git add -A && git commit -m "refactor: render avatars through the unified core Avatar" && cd ..
cd mail && git add -A && git commit -m "refactor: render avatars through the unified core Avatar" && cd ..
```

---

## Task 7: Migrate contacts and calendar

**Files:**
- Modify: `contacts/tinycld/contacts/components/ContactAvatar.tsx`, `contacts/tinycld/contacts/screens/directory.tsx:120`
- Modify: `calendar/tinycld/calendar/components/sharing/AddMemberDialog.tsx:242`, `calendar/tinycld/calendar/components/sharing/MemberRow.tsx:33`

**Interfaces:**
- Consumes: `Avatar` from core (Task 2).
- Produces: `ContactAvatar` stays exported from contacts as a re-export.

- [ ] **Step 1: Create both branches**

```bash
cd contacts && git checkout -b feat/org-and-user-avatars && cd ..
cd calendar && git checkout -b feat/org-and-user-avatars && cd ..
```

- [ ] **Step 2: Repoint the contacts re-export**

`contacts/tinycld/contacts/components/ContactAvatar.tsx` becomes:

```tsx
export { Avatar as ContactAvatar } from '@tinycld/core/components/Avatar'
```

- [ ] **Step 3: Migrate the contacts directory screen**

In `contacts/tinycld/contacts/screens/directory.tsx:120`, change the import to `import { Avatar } from '@tinycld/core/components/Avatar'`, rename the element to `<Avatar … />`, and join `firstName`/`lastName` into `name` as in Task 5 Step 3. Pass `email` alongside when the contact record has one, and keep the existing `colorKey={contact.id}`.

- [ ] **Step 4: Migrate calendar's two soft-variant sites**

In both calendar files, change the import to `import { Avatar } from '@tinycld/core/components/Avatar'` and replace:

```tsx
<Avatar name={name} email={email} size={32} palette="soft" shape="squircle" />
```

matching each site's existing `size` (32 in `AddMemberDialog.tsx`, 36 in `MemberRow.tsx`, and `member.name`/`member.email` in the latter).

- [ ] **Step 5: Verify no stragglers**

Run: `grep -rn "NameAvatar\|MemberAvatar" contacts/tinycld calendar/tinycld | grep -v node_modules`
Expected: no output.

- [ ] **Step 6: Run both packages' checks**

Run: `cd contacts && pnpm exec tinycld-pkg check` then `cd calendar && pnpm exec tinycld-pkg check`
Expected: both green.

- [ ] **Step 7: Commit both**

```bash
cd contacts && git add -A && git commit -m "refactor: render avatars through the unified core Avatar" && cd ..
cd calendar && git add -A && git commit -m "refactor: render avatars through the unified core Avatar" && cd ..
```

---

## Task 8: Schema and server guard for the new fields

**Files:**
- Create: `tinycld/core/server/pb_migrations/2020000000_add_users_avatar_fields.js`
- Create: `tinycld/core/server/pb_migrations/2020000001_create_org_branding.js`
- Modify: `tinycld/core/server/coreserver/users_guard.go`
- Modify: `tinycld/core/server/coreserver/users_guard_test.go`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `users.avatar_crop`, `users.avatar_color`, `users.avatar_emoji` (all self-editable); the `org_branding` collection with fields `logo`, `logo_crop`.

**Critical:** `RegisterUsersFieldGuard` rejects any update touching a field outside its allowlist. Adding the columns without updating `selfEditableUserFields` makes every avatar write fail with a 403 — the schema alone is not enough.

- [ ] **Step 1: Write the failing Go test**

Append to `tinycld/core/server/coreserver/users_guard_test.go`, following the existing `setupGuardTestApp` pattern already in that file (add the three fields to the collection there too, alongside `is_demo`/`disabled`/`role`):

```go
func TestGuardAllowsSelfAvatarCustomization(t *testing.T) {
	app := setupGuardTestApp(t)
	registerUsersFieldGuardCore(app)

	user := createGuardUser(t, app, "self@test.local", "member")

	user.Set("avatar_crop", `{"x":0.25,"y":0.5,"zoom":2}`)
	user.Set("avatar_color", "#3b82f6")
	user.Set("avatar_emoji", "🦖")

	if err := saveAsUser(t, app, user, user); err != nil {
		t.Fatalf("self avatar customization must be allowed, got: %v", err)
	}
}

func TestGuardRejectsAvatarCustomizationOfAnotherUser(t *testing.T) {
	app := setupGuardTestApp(t)
	registerUsersFieldGuardCore(app)

	admin := createGuardUser(t, app, "admin@test.local", "admin")
	target := createGuardUser(t, app, "target@test.local", "member")

	// An admin may set another user's `avatar`, but their crop, color and
	// emoji are personal presentation choices, not administrative state.
	target.Set("avatar_emoji", "🦖")

	if err := saveAsUser(t, app, target, admin); err == nil {
		t.Fatal("an admin must not change another user's avatar_emoji")
	}
}
```

Use whatever helper names the existing test file already defines for creating a user and performing an authenticated save; if they differ from `createGuardUser`/`saveAsUser`, use the existing ones rather than adding duplicates.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tinycld/core/server && go test ./coreserver/ -run TestGuardAllows.*Avatar -v`
Expected: FAIL — the fields are not in the allowlist, so the self-edit is rejected.

- [ ] **Step 3: Add the fields to the guard allowlist**

In `tinycld/core/server/coreserver/users_guard.go`, extend `selfEditableUserFields`:

```go
var selfEditableUserFields = map[string]bool{
	"name":         true,
	"avatar":       true,
	"avatar_crop":  true,
	"avatar_color": true,
	"avatar_emoji": true,
	"password":     true,
}
```

Leave `adminEditableUserFields` alone: an admin may already replace a user's `avatar` file, but crop, color and emoji are personal presentation choices. Update the doc comment above `selfEditableUserFields` to say so.

- [ ] **Step 4: Run the Go test to verify it passes**

Run: `cd tinycld/core/server && go test ./coreserver/ -run TestGuard -v`
Expected: PASS, including the pre-existing guard tests.

- [ ] **Step 5: Write the users migration**

Create `tinycld/core/server/pb_migrations/2020000000_add_users_avatar_fields.js`:

```js
/// <reference path="../pb_data/types.d.ts" />
// Avatar customization: how a user's circle renders when they don't want the
// default hashed-color initials.
//
// `avatar` (the file) already existed and was unused. These three carry the
// rest: how the photo is framed, and the two ways to customize without
// uploading anything. The crop is stored rather than baked into the image so
// re-framing never needs a re-upload, and one stored file serves every size.
//
// All three are self-editable only — see selfEditableUserFields in
// coreserver/users_guard.go, which must allow a field or writes 403.
migrate(
    app => {
        const users = app.findCollectionByNameOrId('users')

        users.fields.addAt(
            users.fields.length,
            new Field({
                id: 'users_avatar_crop',
                name: 'avatar_crop',
                type: 'text',
                max: 200,
            })
        )
        users.fields.addAt(
            users.fields.length,
            new Field({
                id: 'users_avatar_color',
                name: 'avatar_color',
                type: 'text',
                max: 20,
            })
        )
        users.fields.addAt(
            users.fields.length,
            new Field({
                id: 'users_avatar_emoji',
                name: 'avatar_emoji',
                type: 'text',
                max: 16,
            })
        )

        app.save(users)
    },
    app => {
        const users = app.findCollectionByNameOrId('users')
        users.fields.removeById('users_avatar_crop')
        users.fields.removeById('users_avatar_color')
        users.fields.removeById('users_avatar_emoji')
        app.save(users)
    }
)
```

- [ ] **Step 6: Write the org_branding migration**

Create `tinycld/core/server/pb_migrations/2020000001_create_org_branding.js`:

```js
/// <reference path="../pb_data/types.d.ts" />
// org_branding: the deployment's uploaded logo.
//
// A collection of its own rather than a row in system_settings, because that
// collection is key/value TEXT with admin-only read — and the logo has to be
// world-readable: login and other pre-auth screens render it before any token
// exists. Public read here is what lets /api/org-info hand out a URL that
// works unauthenticated.
//
// Single row, id 'branding'. Writes are owner/admin only, matching how the
// rest of deployment configuration is gated.
migrate(
    app => {
        // `disabled != true` matches 1910000010_create_system_settings,
        // 1960000000_audit_logs_admin_only and 1970000000_admin_console_role_rules:
        // without it, an admin account that has just been suspended keeps write
        // access for as long as its already-issued JWT lives. (1950000000 predates
        // that hardening pass and is legacy debt — do not copy it.)
        const ADMIN =
            '@request.auth.id != "" && @request.auth.disabled != true && ' +
            '(@request.auth.role = "owner" || @request.auth.role = "admin")'

        const col = new Collection({
            id: 'pbc_org_branding',
            name: 'org_branding',
            type: 'base',
            system: false,
            listRule: '',
            viewRule: '',
            createRule: ADMIN,
            updateRule: ADMIN,
            deleteRule: ADMIN,
            fields: [
                {
                    id: 'ob_logo',
                    name: 'logo',
                    type: 'file',
                    maxSelect: 1,
                    maxSize: 2097152,
                    mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
                },
                {
                    id: 'ob_logo_crop',
                    name: 'logo_crop',
                    type: 'text',
                    max: 200,
                },
                {
                    id: 'ob_created',
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    id: 'ob_updated',
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
        })
        app.save(col)
    },
    app => {
        app.delete(app.findCollectionByNameOrId('org_branding'))
    }
)
```

- [ ] **Step 7: Regenerate types and verify the schema applied**

Run: `cd ~/code/tinycld && pnpm install`

This re-runs the generator, which regenerates `tinycld/core/types/pbSchema.ts` and `pbZodSchema.ts` from the on-disk migrations. Then confirm:

```bash
grep -n "avatar_crop\|avatar_color\|avatar_emoji" tinycld/core/types/pbSchema.ts
grep -n "OrgBranding" tinycld/core/types/pbSchema.ts
```

Expected: the three fields appear on the `Users` interface and an `OrgBranding` interface exists. These files are generated — never hand-edit them.

- [ ] **Step 8: Register org_branding as a collection**

In `tinycld/core/lib/pocketbase.ts`, add `org_branding` alongside the existing core collections so `useStore('org_branding')` resolves. Follow the exact registration shape already used by the neighboring core collections in that file.

- [ ] **Step 9: Run core's checks**

Run: `cd tinycld/core && pnpm exec tinycld-pkg check` and `cd tinycld/core/server && go test ./...`
Expected: both green.

- [ ] **Step 10: Commit**

```bash
git add tinycld/core/server/pb_migrations/2020000000_add_users_avatar_fields.js
git add tinycld/core/server/pb_migrations/2020000001_create_org_branding.js
git add tinycld/core/server/coreserver/users_guard.go tinycld/core/server/coreserver/users_guard_test.go
git add tinycld/core/lib/pocketbase.ts
git commit -m "feat(core): add avatar customization fields and org_branding collection"
```

---

## Task 9: Serve the org logo from /api/org-info

**Files:**
- Modify: `tinycld/core/server/coreserver/org_info.go`
- Modify: `tinycld/core/server/coreserver/org_info_test.go`
- Modify: `tinycld/core/lib/use-org-info.ts`
- Modify: `tinycld/core/components/OrgLogo.tsx`

**Interfaces:**
- Consumes: the `org_branding` collection (Task 8), `Avatar` (Task 2), `parseCrop` (Task 1).
- Produces: `OrgBranding` gains `logoUrl: string` and `logoCrop: string`; `/api/org-info` returns `{ name, logoUrl, logoCrop }`.

- [ ] **Step 1: Write the failing Go test**

Append to `tinycld/core/server/coreserver/org_info_test.go`, following the request-shape helpers the existing tests in that file already use:

```go
func TestOrgInfoReturnsEmptyLogoWhenUnset(t *testing.T) {
	// A deployment that has never uploaded a logo must still answer cleanly:
	// the client renders name-initials from the same response.
	body := requestOrgInfo(t)

	if body["logoUrl"] != "" {
		t.Fatalf("expected empty logoUrl, got %q", body["logoUrl"])
	}
}

func TestOrgInfoServesUploadedLogo(t *testing.T) {
	app, body := requestOrgInfoWithBranding(t, "logo_abc.png", `{"x":0.5,"y":0.5,"zoom":1}`)
	defer app.Cleanup()

	if body["logoUrl"] == "" {
		t.Fatal("expected a logoUrl once a logo record exists")
	}
	if !strings.Contains(body["logoUrl"], "logo_abc.png") {
		t.Fatalf("logoUrl should reference the stored file, got %q", body["logoUrl"])
	}
	if body["logoCrop"] == "" {
		t.Fatal("expected the stored crop to be served alongside the URL")
	}
}
```

Write `requestOrgInfo` / `requestOrgInfoWithBranding` as small helpers in the test file if equivalents don't already exist: build a `tests.TestApp`, create the `org_branding` collection and (for the second) a record with those values, register the endpoint, issue a GET, and decode into `map[string]string`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd tinycld/core/server && go test ./coreserver/ -run TestOrgInfo -v`
Expected: FAIL — the response has no `logoUrl` key.

- [ ] **Step 3: Extend the endpoint**

In `tinycld/core/server/coreserver/org_info.go`, keep the existing doc comment and extend the handler to look up the single `org_branding` record and include its file URL. A missing collection or record is not an error — the deployment simply has no logo:

```go
e.Router.GET("/api/org-info", func(re *core.RequestEvent) error {
	logoURL, logoCrop := orgLogo(app)
	return re.JSON(http.StatusOK, map[string]string{
		"name":     app.Settings().Meta.AppName,
		"logoUrl":  logoURL,
		"logoCrop": logoCrop,
	})
})
```

and add:

```go
// orgLogo returns the deployment logo's public URL and stored crop, or empty
// strings when none is set. Every failure path is "no logo": this endpoint is
// unauthenticated and on the pre-login path, so it must never 500 because
// branding is absent or the collection has not been migrated yet.
func orgLogo(app core.App) (string, string) {
	record, err := app.FindFirstRecordByFilter("org_branding", "id != ''")
	if err != nil || record == nil {
		return "", ""
	}
	filename := record.GetString("logo")
	if filename == "" {
		return "", ""
	}
	return "/api/files/org_branding/" + record.Id + "/" + filename, record.GetString("logo_crop")
}
```

- [ ] **Step 4: Run the Go test to verify it passes**

Run: `cd tinycld/core/server && go test ./coreserver/ -run TestOrgInfo -v`
Expected: PASS.

- [ ] **Step 5: Extend the client hook**

In `tinycld/core/lib/use-org-info.ts`, widen `OrgBranding` and `fetchOrgInfo`. Keep the existing comment block explaining the synthetic id.

Note this file has no `slug`, `orgSlug`, or `orgId` — `useOrgInfo` returns `{ org }` only. Add the two logo fields and change nothing else about its shape:

```ts
export interface OrgBranding {
    id: string
    name: string
    logoUrl: string
    logoCrop: string
}

export async function fetchOrgInfo(): Promise<{
    name: string
    logoUrl: string
    logoCrop: string
}> {
    const addr = getResolvedAddress()
    if (!addr) return { name: '', logoUrl: '', logoCrop: '' }
    const res = await fetch(`${addr}/api/org-info`, { cache: 'no-store' })
    if (!res.ok) return { name: '', logoUrl: '', logoCrop: '' }
    const body = (await res.json()) as Partial<{
        name: string
        logoUrl: string
        logoCrop: string
    }>
    return {
        name: body.name ?? '',
        logoUrl: body.logoUrl ?? '',
        logoCrop: body.logoCrop ?? '',
    }
}
```

In `useOrgInfo`, build the org object with the absolute logo URL (the endpoint returns a server-relative path):

```ts
    const name = data?.name?.trim() ?? ''
    const addr = getResolvedAddress()
    const logoPath = data?.logoUrl ?? ''
    const org: OrgBranding | null = name
        ? {
              id: 'org',
              name,
              logoUrl: logoPath && addr ? `${addr}${logoPath}` : '',
              logoCrop: data?.logoCrop ?? '',
          }
        : null
    return { org }
```

- [ ] **Step 6: Render the logo in OrgLogo**

```tsx
import { Avatar } from '@tinycld/core/components/Avatar'
import { parseCrop } from '@tinycld/core/lib/avatar'
import type { ReactNode } from 'react'

interface OrgLogoProps {
    org: { id: string; name: string; logoUrl?: string; logoCrop?: string } | null | undefined
    size?: number
    /** Rendered when org is null/loading. Defaults to nothing. */
    fallback?: ReactNode
}

/**
 * Round avatar for the organization: the uploaded logo when one is set,
 * otherwise consistent colored initials keyed off the org name.
 */
export function OrgLogo({ org, size = 36, fallback = null }: OrgLogoProps) {
    if (!org) return <>{fallback}</>

    const avatar = org.logoUrl
        ? { fileUrl: org.logoUrl, crop: parseCrop(org.logoCrop) }
        : undefined

    return <Avatar name={org.name} colorKey={org.id} size={size} avatar={avatar} />
}
```

`PackageRail` is the ONLY remaining `<OrgLogo>` call site — `UserMenu` and `MoreDrawer` dropped it in commit `b8f01c0` ("drop the multi-org client surface"), which predates this plan. It passes the org straight from `useOrgInfo`, so it picks this up with no change.

- [ ] **Step 7: Run core's checks**

Run: `cd tinycld/core && pnpm exec tinycld-pkg check` and `cd tinycld/core/server && go test ./coreserver/`
Expected: both green.

- [ ] **Step 8: Commit**

```bash
git add tinycld/core/server/coreserver/org_info.go tinycld/core/server/coreserver/org_info_test.go
git add tinycld/core/lib/use-org-info.ts tinycld/core/components/OrgLogo.tsx
git commit -m "feat(core): serve the organization logo from /api/org-info"
```

---

## Task 10: Downscale-on-pick and the avatar URL hook

**Files:**
- Create: `tinycld/core/lib/downscale-image.ts` (native), `tinycld/core/lib/downscale-image.web.ts` (web)
- Create: `tinycld/core/lib/use-avatar-url.ts`
- Create: `tinycld/core/tests/unit/downscale-image.test.ts`

**Interfaces:**
- Consumes: `parseCrop` (Task 1), `AvatarImage` (Task 2).
- Produces: `MAX_AVATAR_EDGE = 1024`, `JPEG_QUALITY = 0.85`, `fitWithinMaxEdge(width: number, height: number, maxEdge?: number): { width: number; height: number }`, `downscaleImage(uri: string, mimeType: string): Promise<{ uri: string; mimeType: string }>`, and `useAvatarUrl(user): AvatarImage | undefined`.

Metro resolves `.web.ts` over `.ts` automatically — the two files share one import specifier. Only the pure sizing math is unit-tested; the platform bodies are exercised by the e2e in Task 13.

- [ ] **Step 1: Write the failing test**

Create `tinycld/core/tests/unit/downscale-image.test.ts`:

```ts
import { fitWithinMaxEdge, MAX_AVATAR_EDGE } from '@tinycld/core/lib/downscale-image'
import { describe, expect, it } from 'vitest'

describe('fitWithinMaxEdge', () => {
    it('leaves an already-small image untouched', () => {
        expect(fitWithinMaxEdge(400, 300)).toEqual({ width: 400, height: 300 })
    })

    it('caps a wide image on its width and keeps the aspect ratio', () => {
        expect(fitWithinMaxEdge(4000, 2000)).toEqual({ width: 1024, height: 512 })
    })

    it('caps a tall image on its height', () => {
        expect(fitWithinMaxEdge(2000, 4000)).toEqual({ width: 512, height: 1024 })
    })

    it('caps a square image on both edges', () => {
        expect(fitWithinMaxEdge(3000, 3000)).toEqual({
            width: MAX_AVATAR_EDGE,
            height: MAX_AVATAR_EDGE,
        })
    })

    it('rounds to whole pixels', () => {
        const { width, height } = fitWithinMaxEdge(3000, 1777)
        expect(Number.isInteger(width)).toBe(true)
        expect(Number.isInteger(height)).toBe(true)
    })

    it('never returns a zero dimension for a degenerate input', () => {
        const { width, height } = fitWithinMaxEdge(10000, 1)
        expect(width).toBeGreaterThan(0)
        expect(height).toBeGreaterThan(0)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tinycld/core && pnpm exec vitest run tests/unit/downscale-image.test.ts`
Expected: FAIL — cannot resolve `@tinycld/core/lib/downscale-image`.

- [ ] **Step 3: Write the shared sizing math and the native implementation**

Create `tinycld/core/lib/downscale-image.ts`:

```ts
import { log } from '@tinycld/core/lib/logger'
import * as ImageManipulator from 'expo-image-manipulator'

/**
 * Avatars store the picked image rather than a rasterized crop, so the upload
 * has to be small enough that a 4MB phone photo isn't downloaded to paint a
 * 24px circle. Capping the longest edge is what makes that trade affordable.
 */
export const MAX_AVATAR_EDGE = 1024
export const JPEG_QUALITY = 0.85

export function fitWithinMaxEdge(
    width: number,
    height: number,
    maxEdge = MAX_AVATAR_EDGE
): { width: number; height: number } {
    const longest = Math.max(width, height)
    if (longest <= maxEdge) return { width, height }

    const scale = maxEdge / longest
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
    }
}

/**
 * Cap and re-encode a picked image. PNG sources keep their alpha (an org
 * wordmark on a transparent ground must survive dark mode); everything else
 * re-encodes to JPEG, since a photo behind a circular mask has no use for
 * transparency.
 *
 * A failure here is not fatal — the original is uploaded and the server's
 * max-size check is the backstop.
 */
export async function downscaleImage(
    uri: string,
    mimeType: string
): Promise<{ uri: string; mimeType: string }> {
    const isPng = mimeType === 'image/png'
    try {
        const result = await ImageManipulator.manipulateAsync(
            uri,
            [{ resize: { width: MAX_AVATAR_EDGE } }],
            {
                compress: isPng ? 1 : JPEG_QUALITY,
                format: isPng ? ImageManipulator.SaveFormat.PNG : ImageManipulator.SaveFormat.JPEG,
            }
        )
        return { uri: result.uri, mimeType: isPng ? 'image/png' : 'image/jpeg' }
    } catch (err) {
        log.warn('core.avatar', 'native downscale failed; uploading original', { err })
        return { uri, mimeType }
    }
}
```

If `expo-image-manipulator` is not already a dependency, do **not** add it — the Global Constraints forbid new dependencies. Instead pass `allowsEditing: false` and rely on `expo-image-picker`'s `quality: 0.85` at the pick site in Task 12, and have `downscaleImage` on native return its input unchanged with a comment saying the web path does the real work and native relies on the picker's own compression.

- [ ] **Step 4: Write the web implementation**

Create `tinycld/core/lib/downscale-image.web.ts`:

```ts
import { log } from '@tinycld/core/lib/logger'

export { fitWithinMaxEdge, JPEG_QUALITY, MAX_AVATAR_EDGE } from './downscale-image-shared'
import { fitWithinMaxEdge, JPEG_QUALITY } from './downscale-image-shared'

/**
 * Canvas downscale. Web is the majority of users and the picker gives us the
 * raw file, so this is where the size cap actually earns its keep.
 */
export async function downscaleImage(
    uri: string,
    mimeType: string
): Promise<{ uri: string; mimeType: string }> {
    const isPng = mimeType === 'image/png'
    try {
        const image = await loadImage(uri)
        const { width, height } = fitWithinMaxEdge(image.naturalWidth, image.naturalHeight)

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) return { uri, mimeType }
        ctx.drawImage(image, 0, 0, width, height)

        const outputType = isPng ? 'image/png' : 'image/jpeg'
        const blob = await new Promise<Blob | null>(resolve => {
            canvas.toBlob(resolve, outputType, isPng ? undefined : JPEG_QUALITY)
        })
        if (!blob) return { uri, mimeType }

        return { uri: URL.createObjectURL(blob), mimeType: outputType }
    } catch (err) {
        log.warn('core.avatar', 'web downscale failed; uploading original', { err })
        return { uri, mimeType }
    }
}

function loadImage(uri: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const image = new window.Image()
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error('image decode failed'))
        image.src = uri
    })
}
```

Extract `MAX_AVATAR_EDGE`, `JPEG_QUALITY` and `fitWithinMaxEdge` into `tinycld/core/lib/downscale-image-shared.ts` and have the native file re-export them too, so the constants have exactly one definition and the unit test imports resolve on either platform.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd tinycld/core && pnpm exec vitest run tests/unit/downscale-image.test.ts`
Expected: PASS. Point the test's import at `@tinycld/core/lib/downscale-image-shared` if vitest resolves the native entry.

- [ ] **Step 6: Write the avatar URL hook**

Create `tinycld/core/lib/use-avatar-url.ts`:

```ts
import type { AvatarImage } from '@tinycld/core/components/Avatar'
import { parseCrop } from '@tinycld/core/lib/avatar'
import { pb } from '@tinycld/core/lib/pocketbase'
import { useFileToken } from '@tinycld/core/file-viewer/use-authed-file-url'

/** One stored bitmap serves every circle, from an 18px watcher to a 96px preview. */
const AVATAR_THUMB = '256x256'

interface AvatarUser {
    id: string
    avatar?: string
    avatar_crop?: string
}

/**
 * Build the display source for a user's stored avatar.
 *
 * Files sit behind the users collection's view rule, so the URL carries the
 * shared `?token=`. useFileToken caches one token per session and dedupes
 * across consumers, which is exactly the shape a board full of avatars needs —
 * and because the token is stable for the session, the browser's URL-keyed
 * cache actually hits instead of busting on every render.
 */
export function useAvatarUrl(user: AvatarUser | null | undefined): AvatarImage | undefined {
    const { data: token } = useFileToken()

    if (!user?.avatar) return undefined

    const url = pb.files.getURL({ collectionId: 'users', id: user.id }, user.avatar, {
        token: token ?? '',
    })

    return {
        fileUrl: `${url}${url.includes('?') ? '&' : '?'}thumb=${AVATAR_THUMB}`,
        crop: parseCrop(user.avatar_crop),
    }
}
```

- [ ] **Step 7: Run core's checks**

Run: `cd tinycld/core && pnpm exec tinycld-pkg check`
Expected: green.

- [ ] **Step 8: Commit**

```bash
git add tinycld/core/lib/downscale-image*.ts tinycld/core/lib/use-avatar-url.ts
git add tinycld/core/tests/unit/downscale-image.test.ts
git commit -m "feat(core): add avatar image downscaling and URL resolution"
```

---

## Task 11: The `AvatarCropper` component

**Files:**
- Create: `tinycld/core/components/AvatarCropper.tsx`
- Create: `tinycld/core/tests/unit/avatar-cropper.test.tsx`

**Interfaces:**
- Consumes: `CropRect`, `DEFAULT_CROP`, `clampCrop`, `cropToTransform` (Task 1).
- Produces: `AvatarCropper` with props `{ imageUri: string; initialCrop?: CropRect; size?: number; onCommit: (rect: CropRect) => void; onCancel: () => void }`.

The gesture math converts pan/zoom into the same normalized rect `Avatar` consumes, so the preview and the stored result cannot disagree.

- [ ] **Step 1: Write the failing test**

Create `tinycld/core/tests/unit/avatar-cropper.test.tsx`. Same idiom as Tasks 2
and 3 — `@testing-library/react` under happy-dom. Presses are DOM `click`
events via `fireEvent.click`, not `fireEvent.press`; zoom is driven through the
control's own DOM event:

```tsx
// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { AvatarCropper } from '@tinycld/core/components/AvatarCropper'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Gesture handler and expo-image are native wrappers with no value under Node.
vi.mock('react-native-gesture-handler', () => ({
    Gesture: {
        Pan: () => ({ onBegin: () => ({ onUpdate: () => ({ runOnJS: () => ({}) }) }) }),
        Pinch: () => ({ onUpdate: () => ({ runOnJS: () => ({}) }) }),
        Simultaneous: () => ({}),
    },
    GestureDetector: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('expo-image', () => ({ Image: () => <img alt="" /> }))

afterEach(cleanup)

function setup(initialCrop?: { x: number; y: number; zoom: number }) {
    const onCommit = vi.fn()
    const onCancel = vi.fn()
    const { container } = render(
        <AvatarCropper
            imageUri="https://example.test/a.jpg"
            initialCrop={initialCrop}
            onCommit={onCommit}
            onCancel={onCancel}
        />
    )
    const byId = (id: string) => {
        const node = container.querySelector(`[testid="${id}"]`) as HTMLElement | null
        if (!node) throw new Error(`${id} did not render`)
        return node
    }
    return { onCommit, onCancel, byId }
}

describe('AvatarCropper', () => {
    it('commits the initial crop unchanged when nothing is adjusted', () => {
        const { onCommit, byId } = setup({ x: 0.25, y: 0.75, zoom: 2 })
        fireEvent.click(byId('avatar-cropper-save'))
        expect(onCommit).toHaveBeenCalledWith({ x: 0.25, y: 0.75, zoom: 2 })
    })

    it('commits the zoom the control reports', () => {
        const { onCommit, byId } = setup()
        fireEvent.change(byId('avatar-cropper-zoom'), { target: { value: '3' } })
        fireEvent.click(byId('avatar-cropper-save'))
        expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ zoom: 3 }))
    })

    it('never commits a zoom below 1', () => {
        const { onCommit, byId } = setup()
        fireEvent.change(byId('avatar-cropper-zoom'), { target: { value: '0.1' } })
        fireEvent.click(byId('avatar-cropper-save'))
        expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ zoom: 1 }))
    })

    it('calls onCancel without committing', () => {
        const { onCommit, onCancel, byId } = setup()
        fireEvent.click(byId('avatar-cropper-cancel'))
        expect(onCancel).toHaveBeenCalled()
        expect(onCommit).not.toHaveBeenCalled()
    })
})
```

The zoom control must therefore be something that emits a DOM `change` with a
numeric `value` — a plain `<input type="range">` on web is the simplest thing
that satisfies both this test and the accessibility requirement. Adapt the two
zoom tests to whatever control you build, but keep the `avatar-cropper-zoom`
testID and the clamping assertions.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd tinycld/core && pnpm exec vitest run tests/unit/avatar-cropper.test.tsx`
Expected: FAIL — cannot resolve `@tinycld/core/components/AvatarCropper`.

- [ ] **Step 3: Write the implementation**

Create `tinycld/core/components/AvatarCropper.tsx`. Structure it so the committed value flows through `clampCrop`, and so the preview uses `cropToTransform` — the same function `Avatar` uses:

```tsx
import { clampCrop, type CropRect, cropToTransform, DEFAULT_CROP } from '@tinycld/core/lib/avatar'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Image } from 'expo-image'
import { useRef, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'

interface AvatarCropperProps {
    imageUri: string
    initialCrop?: CropRect
    size?: number
    onCommit: (rect: CropRect) => void
    onCancel: () => void
}

/**
 * Pan/zoom framing for an avatar, with a circular mask over a square viewport.
 *
 * Nothing is rasterized: the committed value is the same normalized rect that
 * Avatar renders from, so what the user frames here is exactly what every
 * circle in the app shows, and re-opening restores their framing.
 *
 * The zoom slider is not decoration — it is the accessible path for pointer
 * users with no pinch gesture and no trackpad.
 */
export function AvatarCropper({
    imageUri,
    initialCrop = DEFAULT_CROP,
    size = 260,
    onCommit,
    onCancel,
}: AvatarCropperProps) {
    const [crop, setCrop] = useState<CropRect>(() => clampCrop(initialCrop))
    const panStart = useRef<CropRect>(crop)
    const foregroundColor = useThemeColor('foreground')

    // Gesture callbacks run on the UI thread. Crossing back to JS on every
    // frame would thrash React state, so the handlers mutate a ref-like
    // snapshot and commit through `runOnJS` only at gesture end — the pattern
    // `core/ui/sheet/index.tsx` uses (import `runOnJS` from
    // react-native-reanimated; do NOT use a `.runOnJS(true)` builder method,
    // which is not this version's API).
    const commit = (next: CropRect) => setCrop(clampCrop(next))

    const panGesture = Gesture.Pan()
        .onBegin(() => {
            panStart.current = crop
        })
        .onUpdate(event => {
            // Dragging the image right moves the focal point left.
            const travel = size * (crop.zoom - 1) || size
            runOnJS(commit)({
                x: panStart.current.x - event.translationX / travel,
                y: panStart.current.y - event.translationY / travel,
                zoom: panStart.current.zoom,
            })
        })

    const pinchGesture = Gesture.Pinch().onUpdate(event => {
        runOnJS(commit)({ ...crop, zoom: crop.zoom * event.scale })
    })

    const transform = cropToTransform(crop, size)

    return (
        <View className="gap-4 items-center">
            <GestureDetector gesture={Gesture.Simultaneous(panGesture, pinchGesture)}>
                <View
                    testID="avatar-cropper-viewport"
                    className="overflow-hidden bg-surface-secondary"
                    style={{ width: size, height: size, borderRadius: size / 2 }}
                >
                    <Image
                        source={{ uri: imageUri }}
                        contentFit="cover"
                        style={{
                            width: transform.width,
                            height: transform.height,
                            transform: [
                                { translateX: transform.translateX },
                                { translateY: transform.translateY },
                            ],
                        }}
                    />
                </View>
            </GestureDetector>

            <ZoomControl
                zoom={crop.zoom}
                onZoom={zoom => setCrop(current => clampCrop({ ...current, zoom }))}
            />

            <View className="flex-row gap-3">
                <Pressable
                    testID="avatar-cropper-save"
                    onPress={() => onCommit(clampCrop(crop))}
                    className="rounded-lg px-4 py-2.5 bg-primary"
                >
                    <Text className="text-primary-foreground font-semibold">Save</Text>
                </Pressable>
                <Pressable
                    testID="avatar-cropper-cancel"
                    onPress={onCancel}
                    className="rounded-lg px-4 py-2.5 border border-border"
                >
                    <Text className="font-semibold" style={{ color: foregroundColor }}>
                        Cancel
                    </Text>
                </Pressable>
            </View>
        </View>
    )
}
```

**Core has no slider component** — verified, `tinycld/core/ui/` contains none — and the Global Constraints forbid adding a dependency. Write `ZoomControl` in this same file as a small platform-split control:

```tsx
function ZoomControl({ zoom, onZoom }: { zoom: number; onZoom: (zoom: number) => void }) {
    if (Platform.OS === 'web') {
        // A native range input is the accessible, keyboard-operable choice on
        // web, and it is what the majority of users get.
        return (
            <input
                testid="avatar-cropper-zoom"
                aria-label="Zoom"
                type="range"
                min={1}
                max={8}
                step={0.1}
                value={zoom}
                onChange={event => onZoom(Number(event.target.value))}
                style={{ width: '100%' }}
            />
        )
    }

    // Native gets pinch-to-zoom from the gesture above; these are the
    // discrete fallback for anyone who can't pinch.
    return (
        <View testID="avatar-cropper-zoom" className="flex-row gap-3">
            <ZoomStep label="−" onPress={() => onZoom(zoom - 0.5)} />
            <ZoomStep label="+" onPress={() => onZoom(zoom + 0.5)} />
        </View>
    )
}

function ZoomStep({ label, onPress }: { label: string; onPress: () => void }) {
    return (
        <Pressable onPress={onPress} className="rounded-lg px-4 py-2 border border-border">
            <Text className="text-foreground font-semibold">{label}</Text>
        </Pressable>
    )
}
```

Import `Platform` from `react-native` alongside the existing imports. Clamping happens in the parent's `onZoom`, so neither branch can commit an out-of-range value.

`useState` here is genuinely local synchronous UI state that no other component reads — the case the CLAUDE.md guidance explicitly allows.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd tinycld/core && pnpm exec vitest run tests/unit/avatar-cropper.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tinycld/core/components/AvatarCropper.tsx tinycld/core/tests/unit/avatar-cropper.test.tsx
git commit -m "feat(core): add pan/zoom avatar cropper"
```

---

## Task 12: Settings UI for user avatars and the org logo

**Files:**
- Create: `tinycld/core/components/settings/AvatarSection.tsx`
- Create: `tinycld/core/components/settings/OrgBrandingSection.tsx`
- Create: `tinycld/core/lib/use-org-branding.ts`
- Create: `tinycld/app/a/(app)/settings/organization.tsx`
- Modify: `tinycld/app/a/(app)/settings/personal.tsx` (add `<AvatarSection />` inside `ProfileSection`)
- Modify: `tinycld/app/a/(app)/settings/index.tsx` (add the Organization link)

**Interfaces:**
- Consumes: `Avatar` (2), `AvatarCropper` (11), `useAvatarUrl` + `downscaleImage` (10), `AVATAR_COLORS`, `serializeCrop` (1), `uploadRecordWithFile` (existing), `usePickFiles` (existing, `core/file-viewer/use-pick-files.tsx`).
- Produces: `AvatarSection`, `OrgBrandingSection`, `useOrgBranding()`.

- [ ] **Step 1: Write the org branding hook**

Create `tinycld/core/lib/use-org-branding.ts`. Read the single row with `useOrgLiveQuery`; expose the record (or `null`) plus its id so the upload knows whether to create or update:

```ts
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { useStore } from '@tinycld/core/lib/pocketbase'

/**
 * The deployment's single branding row. Absent until someone uploads a logo,
 * so callers must handle null rather than assuming a row exists.
 */
export function useOrgBranding() {
    const [brandingCollection] = useStore('org_branding')
    const { data } = useOrgLiveQuery((query) =>
        query.from({ branding: brandingCollection })
    )
    return { branding: data?.[0] ?? null, brandingCollection }
}
```

- [ ] **Step 2: Write AvatarSection**

Create `tinycld/core/components/settings/AvatarSection.tsx`. Per the JSX rules, keep state and handlers in a `useAvatarEditor()` hook above the component and keep the returned JSX flat. It must provide:

- The current circle at 96px via `<Avatar>` + `useAvatarUrl(user)`.
- **Upload photo** → `usePickFiles` (photoLibrary/camera) → `downscaleImage` → open `AvatarCropper` → on commit, upload the bytes, then a `useMutation` writing `avatar_crop` via `usersCollection.update`.

  **The user's avatar is an UPDATE, not a create.** `uploadRecordWithFile` POSTs to `/api/collections/<c>/records` — it creates a new row, which is wrong for a `users` record that already exists. Call `uploadFormDataWithProgress` directly instead, with `method: 'PATCH'` and the record URL:

  ```ts
  await uploadFormDataWithProgress({
      url: pb.buildURL(`/api/collections/users/records/${user.id}`),
      formData,            // FormData with the `avatar` file appended
      authToken: pb.authStore.token ?? '',
      method: 'PATCH',
  })
  ```

  That helper's own doc comment says "PATCH is what an update-with-file needs". `uploadRecordWithFile` remains correct for `org_branding`'s FIRST insert (no row exists yet); once a branding row exists, that path must PATCH too.
- **Reposition** (visible only when `user.avatar` is set) → reopens `AvatarCropper` with `parseCrop(user.avatar_crop)`, commits crop only, no re-upload.
- **Choose emoji** → the existing `EmojiPicker` from `@tinycld/core/ui/emoji-picker`, whose `onPick: (glyph: string) => void` writes `avatar_emoji`.
- **Color swatches** → `AVATAR_COLORS` rendered like the existing `ColorThemePicker` in `personal.tsx`, writing `avatar_color`.
- **Remove** → clears `avatar`, `avatar_crop`, `avatar_emoji` in one mutation.

Every field write goes through `useMutation` from `@tinycld/core/lib/mutations`; only the file bytes bypass it (via `uploadFormDataWithProgress` / `uploadRecordWithFile`). Use `handleMutationErrorsWithForm` or `notify` for failures — never a silent catch.

- [ ] **Step 3: Mount it in Personal Settings**

In `tinycld/app/a/(app)/settings/personal.tsx`, import `AvatarSection` and render `<AvatarSection />` as the first child of `ProfileSection`'s returned `View`, above the `FormErrorSummary`.

- [ ] **Step 4: Write OrgBrandingSection and its route**

Create `tinycld/core/components/settings/OrgBrandingSection.tsx` — the same upload/crop/remove flow as `AvatarSection` but against `org_branding` (create the row when `branding` is null, update it otherwise), with **no emoji or color controls**: an org falls back to its name initials.

Create `tinycld/app/a/(app)/settings/organization.tsx` following the exact shape of the sibling `labels.tsx` route (DocumentTitle, back arrow via `useNavigateBack` + `useOrgHref`, heading), rendering `<OrgBrandingSection />`.

- [ ] **Step 5: Link it from the settings index**

In `tinycld/app/a/(app)/settings/index.tsx`, add a link inside the existing `Organization` `SettingsGroup` in `AdminSettings` (which already renders only when `isAdmin`), above `Storage`:

```tsx
                <SettingsLink
                    label="Branding"
                    onPress={() => router.push(orgHref('settings/organization'))}
                    icon={<Image size={20} color={foregroundColor} />}
                />
```

Import `Image` from `lucide-react-native` — alias it (`Image as ImageIcon`) if the file already imports RN's `Image`.

- [ ] **Step 6: Run core's checks**

Run: `cd tinycld/core && pnpm exec tinycld-pkg check` and `cd tinycld && pnpm exec tinycld-pkg check`
Expected: both green.

- [ ] **Step 7: Manually verify both flows**

Run `cd tinycld && pnpm run dev`, then in the browser:
1. Personal Settings → upload a photo, reframe it, save. Confirm the circle updates in the sidebar/user menu.
2. Reopen *Reposition* — the saved framing must be restored, not reset.
3. Pick an emoji, then a color; confirm precedence (a photo still wins over both).
4. Settings → Branding → upload a logo; confirm it appears in the package rail, and still appears after signing out (pre-login).

- [ ] **Step 8: Commit**

```bash
git add tinycld/core/components/settings/AvatarSection.tsx
git add tinycld/core/components/settings/OrgBrandingSection.tsx
git add tinycld/core/lib/use-org-branding.ts
git add "tinycld/app/a/(app)/settings/organization.tsx"
git add "tinycld/app/a/(app)/settings/personal.tsx" "tinycld/app/a/(app)/settings/index.tsx"
git commit -m "feat(core): add avatar and organization branding settings"
```

---

## Task 13: Wire stored avatars into user-facing surfaces, plus e2e

**Files:**
- Modify: `tinycld/core/components/settings/members/MembersDrawer.tsx`, `tinycld/app/a/(app)/settings/members.tsx`
- Modify (boards): `components/detail/DetailProperties.tsx`, `components/detail/DetailActivity.tsx`, `components/table/CardRow.tsx`, `components/BoardCard.tsx` assignees, `components/sharing/MemberRow.tsx`
- Create: `tinycld/tests/e2e/avatar.spec.ts`

**Interfaces:**
- Consumes: `useAvatarUrl` (Task 10), `Avatar` (Task 2).
- Produces: nothing.

Tasks 5–7 migrated the *rendering*; this wires the *stored image* into the surfaces that show a real `users` record. Presence surfaces are deliberately excluded — a watcher must not read as an assignee.

- [ ] **Step 1: Pass avatar/emoji/color where a users record is in hand**

At each listed site the rendered subject is a `users` row, so add:

```tsx
const avatar = useAvatarUrl(user)
…
<Avatar
    name={user.name}
    email={user.email}
    colorKey={user.id}
    avatar={avatar}
    emoji={user.avatar_emoji || undefined}
    color={user.avatar_color || undefined}
    size={…}
/>
```

Hooks must stay at the top level, so where a site renders inside a `.map()`, extract a small row component that calls `useAvatarUrl` itself rather than calling the hook in a loop. Leave `size`, `palette`, and `shape` at each site's existing values.

Ensure each site's query selects `avatar`, `avatar_crop`, `avatar_color`, and `avatar_emoji` — a `.select()` that omits them silently yields no picture.

- [ ] **Step 2: Write the e2e spec**

Create `tinycld/tests/e2e/avatar.spec.ts`. Use the helpers in `tinycld/tests/e2e/helpers.ts` (`login`, `navigateToPackage`); never `page.goto()` for in-app navigation, and set up data by driving the UI, never raw PocketBase writes:

```ts
import { expect, test } from '@playwright/test'
import { login } from './helpers'

test('a user can set an emoji avatar and it renders in the app shell', async ({ page }) => {
    await login(page)

    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByText('Personal').click()

    await page.getByTestId('avatar-choose-emoji').click()
    await page.getByRole('button', { name: '🦖' }).first().click()

    await expect(page.getByTestId('avatar-preview')).toContainText('🦖')

    // The point of the feature: the choice follows the user out of settings.
    await page.reload()
    await expect(page.getByTestId('avatar-preview')).toContainText('🦖')
})

test('an uploaded photo replaces the initials circle', async ({ page }) => {
    await login(page)

    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByText('Personal').click()

    await page.setInputFiles('input[type="file"]', 'tests/e2e/fixtures/avatar.png')
    await page.getByTestId('avatar-cropper-save').click()

    await expect(page.getByTestId('avatar-preview-image')).toBeVisible()
})
```

Add the `avatar-preview` / `avatar-choose-emoji` testIDs to `AvatarSection` in Task 12's component if they aren't already there, and create a small `tinycld/tests/e2e/fixtures/avatar.png` (any valid PNG, ≤100KB).

- [ ] **Step 3: Run the e2e**

Run: `cd tinycld && pnpm exec tinycld-pkg test:e2e -- avatar.spec.ts`
Expected: both tests pass. If one fails, diagnose the root cause and fix it at the source — never bump a timeout, force serial runs, or re-run to get green.

- [ ] **Step 4: Run all checks across every touched member**

Run `pnpm exec tinycld-pkg check` inside `tinycld`, `tinycld/core`, and `boards`; then `cd ~/code/tinycld && pnpm run checks`.
Expected: all green, including `check:core-isolation`.

- [ ] **Step 5: Commit**

```bash
git add -A tinycld/core tinycld/app tinycld/tests
git commit -m "feat(core): show stored avatars across member and card surfaces"
cd boards && git add -A && git commit -m "feat: show stored user avatars on cards and detail views" && cd ..
```

---

## Task 14: In-app help and release

**Files:**
- Create: `tinycld/core/help/personalizing-your-avatar.md`
- Create: `tinycld/core/help/organization-branding.md`
- Modify: core's manifest if `help: { directory: 'help' }` is not already declared

**Interfaces:**
- Consumes: nothing.
- Produces: help topics `core:personalizing-your-avatar` and `core:organization-branding`.

Per CLAUDE.md, a user-facing feature is not done until users can find out how to use it from inside the app.

- [ ] **Step 1: Write the user avatar help topic**

Create `tinycld/core/help/personalizing-your-avatar.md`:

```markdown
---
title: Personalizing your avatar
summary: Upload a photo, pick an emoji, or choose a color for the circle that represents you.
tags: [avatar, profile, "personal settings"]
order: 20
---

Your avatar is the circle that stands for you everywhere in {{server-host}} — on
cards you are assigned, in comment threads, in shared files, and in member
lists. Until you change it, it shows your initials on a color picked from your
account.

To change it, open **Settings → Personal**.

## Upload a photo

Choose **Upload photo** and pick an image. You can then drag to move it and
pinch — or use the zoom slider — to size it inside the circle. Choose **Save**
when the framing looks right.

Your framing is stored separately from the picture, so choosing **Reposition**
later reopens it exactly where you left it. You never have to upload the same
photo twice to fix the framing.

## Use an emoji instead

Choose **Choose emoji** and pick any emoji. It appears in the circle on your
chosen background color. This is a good option if you would rather not upload a
picture of yourself.

## Change the color

Pick any swatch to change the circle's background. The color applies to both
initials and emoji. It has no effect while a photo is set, because the photo
fills the whole circle.

## Remove what you have set

**Remove** clears your photo and emoji and returns you to initials.

An organization's own logo is set separately — see
[Organization branding](help://core:organization-branding).
```

- [ ] **Step 2: Write the org branding help topic**

Create `tinycld/core/help/organization-branding.md`:

```markdown
---
title: Organization branding
summary: Upload a logo that identifies your organization throughout the app.
tags: [branding, logo, organization, admin]
order: 30
---

Your organization's logo appears in the app sidebar, the account menu, and on
the sign-in screen at {{server-host}}. Until you upload one, those places show
your organization's initials.

You need the **owner** or **admin** role to change it.

## Upload a logo

Open **Settings → Branding** and choose **Upload logo**. Drag and zoom to frame
it inside the circle, then choose **Save**.

Transparent PNG files keep their transparency, so a logo made for a light
background still looks correct in dark mode.

## Replace or remove it

**Reposition** reframes the logo you already uploaded without needing the file
again. **Remove** clears it and returns to your organization's initials.

Your own picture is set separately — see
[Personalizing your avatar](help://core:personalizing-your-avatar).
```

- [ ] **Step 3: Regenerate and verify the topics register**

Run:

```bash
cd ~/code/tinycld/tinycld && pnpm run packages:generate
```

Then start the app (`pnpm run dev`), open `/help`, and confirm both topics appear and their cross-links resolve.

- [ ] **Step 4: Run the full ecosystem checks**

Run: `cd ~/code/tinycld && pnpm run checks && pnpm run pkg:check`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add tinycld/core/help/personalizing-your-avatar.md
git add tinycld/core/help/organization-branding.md
git commit -m "docs(core): add help topics for avatars and organization branding"
```

- [ ] **Step 6: Open the pull requests, core first**

Per the Global Constraints, **core must merge before any package PR**. Open and merge the `tinycld` PR, then open the five package PRs from the same branch name. Keep each description short and to the point.

---

## Notes for the implementer

- **The users field guard is the most likely silent failure.** If an avatar write returns 403, check `selfEditableUserFields` in `tinycld/core/server/coreserver/users_guard.go` (Task 8) before suspecting the client.
- **Generated files are never hand-edited:** `tinycld/core/types/pbSchema.ts` and `pbZodSchema.ts` are regenerated from the migrations by `pnpm install`.
- **`pnpm install` runs only at the workspace root**, never inside a member — installing in a member duplicates React and produces hundreds of bogus type errors.
- **Presence circles stay identity-free on purpose.** Do not "finish the job" by wiring stored avatars into `PresenceAvatars` or `CardWatchers`; the distinction is deliberate and documented in the spec.
