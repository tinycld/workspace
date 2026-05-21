# @tinycld/calendar

Shared calendars for your organization — with day, week, month, and schedule views, recurring events, guest management, RSVPs, reminders, external subscriptions, and a native CalDAV endpoint.

Part of [TinyCld](https://tinycld.org/) — the open-source, self-hosted Google Workspace alternative.

## Features

- **Multiple calendars per org.** Each user can own any number of calendars and be invited to others as owner, editor, or viewer.
- **Day, Week, Month, Schedule views.** Keyboard-navigable, color-coded, with a live "now" indicator and all-day event bar.
- **Recurring events.** Daily, weekly, monthly, yearly — stored as iCalendar RRULEs so they round-trip through CalDAV.
- **Guests & RSVP.** Invite attendees by email with `accepted` / `declined` / `tentative` / `pending` status. Organizer vs. attendee roles.
- **Reminders.** Per-event reminder offsets flow through the app shell's unified notification bus (toast + drawer + Expo push).
- **Busy / free & visibility.** Mark events busy or free; keep event details private, public, or default per calendar.
- **Color-coded categories.** 17 named colors (`blueberry`, `sage`, `tangerine`, …) that work in light and dark themes.
- **Calendar subscriptions.** Subscribe to any external `.ics` URL (holidays, sports schedules, teammate calendars). The server polls and refreshes them on a schedule.
- **CalDAV sync.** Native `/caldav/` endpoint. Apple Calendar, GNOME Calendar, DAVx5, Thunderbird — any CalDAV client just works.
- **Real-time updates.** Edits from any client appear instantly in every other session.
- **Quick create.** One-keystroke event creation from any view.

## Protocol

| Protocol | RFC       | Port | Purpose                         |
|----------|-----------|------|---------------------------------|
| CalDAV   | RFC 4791  | 443  | Read/write calendars & events   |

## Relationship to the app shell

`@tinycld/calendar` is a feature package for the [TinyCld app shell](https://github.com/tinycld/tinycld), which bundles `@tinycld/core` (auth, routing, storage, UI primitives). The app shell ships with **no** feature packages; install this one to add a Calendar app.

This package contributes:

- **Screens** — org-scoped routes at `/a/<org>/calendar`.
- **Provider** — a wrapping context that loads calendar memberships and visible-calendar state.
- **Nav entry** — sidebar icon with keyboard shortcut `t c` / `c`.
- **Collections** — `calendar_calendars`, `calendar_members`, `calendar_events` (pbtsdb, live-queried).
- **Migrations** — schema under `pb-migrations/`.
- **Go server module** — CalDAV endpoint, iCalendar parser/serializer, subscription poller, and reminder scheduler wired into the app shell's PocketBase binary.

The package depends on `@tinycld/core` at runtime (React, pbtsdb, `~/lib/*`). The app shell has no knowledge of this package at compile time — everything is discovered at generator time by scanning `tinycld/packages/`.

## Installation

From inside your app shell checkout (`tinycld/tinycld`):

```sh
npm run packages:install <this-repo-git-url>
```

That clones the repo next to the app shell, symlinks it into `tinycld/packages/@tinycld/calendar`, and runs the generator to wire up routes, collections, migrations, and Go server extensions.

To remove:

```sh
npm run packages:unlink @tinycld/calendar
```

## Development

This package is not run standalone — it only makes sense inside an app shell checkout.

```sh
cd ../tinycld
npm run dev              # expo + pocketbase with calendar linked
npm run test:unit        # includes this package's layout tests
npm run checks           # biome + tsc across the app shell + linked packages
```

**Do not** run `npm install` (or any other package manager's install) inside this directory. Peer dependencies resolve through the app shell's `node_modules/`; installing here creates duplicate copies of `react`, `react-native`, etc. and breaks TypeScript.

## License

See the root TinyCld repository for licensing.
