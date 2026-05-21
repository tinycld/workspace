# TinyCld workspace

The npm-workspace root for the TinyCld ecosystem. Clone this repo, then use the
`bootstrap` CLI's tooling mode to clone the members you want to work on
(`app` + `core` are always cloned; add features with `--with`). A single root
`npm install` then links them and runs the generator.

```sh
git clone git@github.com:tinycld/workspace.git ~/code/tinycld
cd ~/code/tinycld
# clone app + core + the package(s) you want, then install:
npx @tinycld/bootstrap@latest --tooling --with mail --with contacts
npm install
cd app && npm run dev
```

You do NOT have to clone every feature — work on a subset. The generator scans
whichever member dirs are present, and the workspace `package.json` tolerates
listing members that aren't checked out.

## Layout

```
~/code/tinycld/            # this repo (workspace root)
    package.json           # the npm workspace member list (all possible members)
    package-scripts/       # the `tinycld-pkg` per-member CLI (ships here)
    tests/                 # shared unit-test stubs
    tinycld.packages.ts    # member enumeration for the generator
    app/                   # @tinycld/app — the shell (own repo)
    core/                  # @tinycld/core — shared lib (own repo)
    contacts/ mail/ ...    # feature packages you chose to clone (own repos)
```

`package-scripts/` (the `tinycld-pkg` CLI) and the root files live in THIS repo;
every other member is its own repo, cloned on demand by `bootstrap --tooling`.
Run `npm install` only here at the root, never inside a member.

## Per-member checks

From any member dir: `npx tinycld-pkg check` (typecheck + unit),
`tinycld-pkg test:e2e` (playwright). From anywhere: `tinycld-pkg <verb> --all`
(runs only the members that are present).
