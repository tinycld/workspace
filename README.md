# TinyCld workspace — example root

> **This is _our_ workspace, published as an example.** It's a real, committed
> pnpm-workspace root showing what a checked-in TinyCld setup looks like — the
> coordination files (`package.json`, `pnpm-workspace.yaml`, `tinycld.packages.ts`,
> `scripts/`) plus the `.gitignore` that keeps each member's own repo out.
>
> **Do not clone or fork this repo.** Every developer's workspace is unique — a
> different set of member packages, a different `pnpm-lock.yaml`, its own remote.
> You assemble *yours* with `@tinycld/bootstrap`, then commit it to *your own*
> repository. This one exists to be read, not to be your starting point.

## How to assemble your own workspace

```sh
mkdir ~/code/tinycld && cd ~/code/tinycld

# Assembles the workspace root + clones the tinycld repo + the packages you list.
npx @tinycld/bootstrap@latest --assemble-only --with mail --with contacts

pnpm install                # links members, runs the generator, syncs .gitignore
cd tinycld && pnpm run dev  # boots Expo + PocketBase
```

`bootstrap --assemble-only` writes the workspace `package.json`, `pnpm-workspace.yaml`,
`tinycld.packages.ts`, `scripts/link-members.ts`, `vitest.config.ts`, and the
shared `tests/` stubs into the current directory, then clones the `tinycld` repo
(which carries `@tinycld/core` + `@tinycld/package-scripts` nested) plus any
`--with <name>` features as siblings. Members are independent git repos with their
own remotes and history.

To add a feature later, either re-run bootstrap with another `--with`, or just
`git clone <url> <name>` into the workspace root and re-run `pnpm install`. To
remove one, delete its directory and re-run `pnpm install`.

## Commit your root to your own repo

You're encouraged to check your assembled root into your own git repository.
`pnpm install` runs `scripts/link-members.ts`, which keeps a self-maintaining
block in `.gitignore` so each member's contents stay in that member's own repo —
only the coordination files are tracked. This is for your own version control;
the **EAS cloud build** doesn't clone your workspace root — it builds from the
`tinycld` app repo and an `eas-build-pre-install` hook clones the feature members
alongside it before installing.

Yours will diverge from this example — different members, different lockfile.
That's expected; there is no one canonical root to share. See the website
[FAQ](https://tinycld.org/docs/faq#why-isnt-there-a-shared-workspace-repo-to-clone)
for the design rationale.

## Layout (for reference)

```
~/code/tinycld/            # workspace root (commit this to your own repo)
    package.json           # packageManager (pnpm), tsx devDep, postinstall
    pnpm-workspace.yaml     # pnpm member list + settings (nodeLinker: hoisted)
    .gitignore             # members auto-ignored by scripts/link-members.ts
    scripts/link-members.ts # links members into node_modules/@tinycld/; syncs .gitignore
    tests/                 # shared unit-test stubs
    tinycld.packages.ts    # member enumeration for the generator
    tinycld/               # the app shell (package "tinycld"; own repo)
        core/              # @tinycld/core — shared lib (nested in tinycld)
        package-scripts/   # the `tinycld-pkg` per-member CLI (nested in tinycld)
    contacts/ mail/ ...    # feature packages you chose (own repos)
```

Run `pnpm install` only at the workspace root, never inside a member.

## Per-member checks

From any member dir: `pnpm exec tinycld-pkg check` (typecheck + unit),
`pnpm exec tinycld-pkg test:e2e` (playwright). From `tinycld/`: `pnpm run pkg:check` /
`pkg:test:unit` / `pkg:test:e2e` to sweep every present member.

See the [bootstrap README](https://github.com/tinycld/bootstrap#readme) for the
full CLI reference.
