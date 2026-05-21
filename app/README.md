# TinyCld

<p align="center">
    <img src=".github/hero.jpeg" alt="TinyCld — self-hosted Workspace alternative with mail, calendar, and drive on a plug-in package SDK" />
</p>

A self-hosted workspace alternative — Expo Router on the front, PocketBase on the
back, every feature shipped as a separately-installable package. See
[tinycld.org](https://tinycld.org) for the full story.

This repo is the runnable app shell. It bundles `@tinycld/core` (the shared TypeScript + Go
library) directly at `packages/@tinycld/core/` along with branding, Expo native projects,
deployment configs, and the package generator. It's the entrypoint for `npm run dev` and
`docker pull ghcr.io/tinycld/tinycld`.

```
~/code/tinycld/
    tinycld/                 # this repo — the app shell (bundles @tinycld/core)
    mail/                    # @tinycld/mail (feature package)
    calendar/                # @tinycld/calendar
    contacts/                # @tinycld/contacts
    drive/                   # @tinycld/drive
    text/                    # @tinycld/text
    calc/                    # @tinycld/calc
    google-takeout-import/   # @tinycld/google-takeout-import
```

Feature siblings import core as `@tinycld/core/*` (and `tinycld.org/core` for Go); each
sibling's tsconfig `paths` and Go go.mod `replace` directive resolves those names onto
this repo's bundled core.

## Quick start

```sh
git clone https://github.com/tinycld/tinycld.git ~/code/tinycld/tinycld
cd ~/code/tinycld/tinycld
npm install
npm run packages:install git@github.com:tinycld/mail.git    # add features as needed
npm run dev
```

`npm run dev` runs three processes in parallel: an HTTP proxy on the user-facing port
7100, the Go PocketBase server on 7101, and the Expo bundler on 7102. The proxy routes
`/api` and `/_` to PB and everything else to Expo, so the app talks to PB same-origin.

If `assets/localhost.pem` + `assets/localhost-key.pem` are present, the proxy serves
TLS — visit `https://localhost:7100`. Otherwise it's plain HTTP at `http://localhost:7100`.
Generate the certs once with [mkcert](https://github.com/FiloSottile/mkcert):

SSL is needed for developing on iOS simulator.  Trust the certs by dropping onto the Settings app.

```sh
brew install mkcert     # macOS — see mkcert docs for other platforms
mkcert -install         # one-time, installs the local CA in your trust store
npm run ssl:generate
```

## What's where

- **`app/`** — Expo Router routes. `_layout.tsx` calls `configureCore(appConfig)` first, then
  imports core's Providers and mounts the gate.
- **`lib/app-config.ts`** — `CoreConfig` value handed to core at boot. Branding, server
  shortcuts, Sentry creds, review-mode flags.
- **`lib/configure-core.ts`** — side-effect-only module imported first by `_layout.tsx` so
  `configureCore` runs before any other `@tinycld/core/*` import.
- **`lib/generated/`** — package-registry/collections/sidebars/providers/settings/seeds.
  Generator output. Gitignored.
- **`packages/@tinycld/core/`** — bundled shared library (`tinycld/core/{lib,ui,components,types}/`,
  `server/coreserver/...`, migrations). No separate git repo.
- **`packages/@tinycld/{mail,calendar,…}`** — symlinks to feature sibling repos. Metro and
  vitest scan this tree.
- **`scripts/generate-packages.ts`** — the generator. Reads `tinycld.packages.ts` + each
  feature package's `manifest.ts`, writes route re-exports, the registry, Go server wiring,
  and PocketBase migration symlinks. Honors `TINYCLD_APP_ROOT`, `TINYCLD_GENERATED_DIR`,
  `TINYCLD_APP_DIR`, `TINYCLD_SERVER_DIR`, `TINYCLD_CORE_IMPORT_ALIAS`.
- **`server/main.go`** — ~50 lines: load env, init Sentry, build `coreserver.Options`, call
  `coreserver.Register(app, opts)`. Module `tinycld.org/app` with
  `replace tinycld.org/core => ../packages/@tinycld/core/server`.
- **`server/pb_migrations/`** — landing dir for symlinks. Generator populates from core's
  `server/pb_migrations/` plus each linked feature package's `pb-migrations/`.
- **`Dockerfile`, `docker-compose.yml`, `eas.json`** — deployment.

## Adding / removing feature packagesq

```sh
npm run packages:install <git-url>     # clone + link + regenerate
npm run packages:link <package-name>   # link an already-cloned sibling
npm run packages:unlink <package-name> # remove a link
```

After any change, `npm run packages:generate` (also runs as `postinstall` and at the start of `npm run dev`).

## Working in this repo

```sh
npm install                      # also runs packages:generate via postinstall hook
npm run checks                   # biome + tsc
npm run test:unit                # vitest
npm run test:e2e                 # playwright
cd server && go build -o tinycld . && ./tinycld --help
```

## Code style

See [CONTRIBUTING.md](CONTRIBUTING.md) for conventions — no `useState`/`useEffect` shortcuts,
semantic Tailwind tokens, pbtsdb for data, etc.

## Deploy

```sh
docker pull ghcr.io/tinycld/tinycld
```

The image bakes the Go binary, Expo web export, PocketBase server, and the
[mail](https://github.com/tinycld/mail),
[calendar](https://github.com/tinycld/calendar),
[contacts](https://github.com/tinycld/contacts),
[drive](https://github.com/tinycld/drive), and
[google-takeout-import](https://github.com/tinycld/google-takeout-import)
packages into one container.
[text](https://github.com/tinycld/text) and [calc](https://github.com/tinycld/calc)
are available but not bundled by default — link them locally with
`npm run packages:install <git-url>` to include them in your own image build.
Healthchecks and Let's Encrypt-friendly cert handling are baked in. Dokku one-liner deploys
work via `app.json` + the `Procfile` analog in `Dockerfile`.

## License

[AGPL-3.0](LICENSE). Commercial relicensing available — open an issue to discuss.
