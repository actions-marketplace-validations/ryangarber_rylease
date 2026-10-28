# Monorepos

A release has one or more **components**: what's versioned and released together, under one version and one tag. Without `components`, the whole project is one. In a monorepo, each package is usually one, and [`npm/workspaces`](reference/npm/workspaces.md) finds them in an npm, Yarn or pnpm workspace; [`dart/workspaces`](reference/dart/workspaces.md) does in a pub or Melos workspace, and [`cargo/workspaces`](reference/cargo/workspaces.md) in a Cargo one:

```yaml
  - uses: ryangarber/rylease@v3
    with:
      components: npm/workspaces
      steps: |
        - uses: conventional
        - uses: components/dependents
        - uses: fs/write-version
          with: { format: npm }
        - uses: fs/write-changes
        - uses: git/commit
        - uses: npm/publish
```

```
  ✔ @x/core  read-version       git/tags                     6ms  @x/core@1.0.0 at 0d92bfa, nearest on HEAD
  ✔ @x/cli   read-version       git/tags                     5ms  @x/cli@1.0.0 at 0d92bfa, nearest on HEAD
  ✔ @x/core  read-changes       conventional/read-commits    9ms  1 change in 1 commit since 0d92bfa
  ✔ @x/cli   read-changes       conventional/read-commits    8ms  0 changes in 0 commits since 0d92bfa
  …
  ✔ *        determine-kind     components/dependents       <1ms  1 dependent released: @x/cli
  ✔ @x/core  determine-version  semver                      <1ms  1.1.0: 'feature' from 1.0.0, bumps minor
  ✔ @x/cli   determine-version  semver                      <1ms  1.0.1: 'fix' from 1.0.0, bumps patch
  …
  ✔ *        write              fs/write-version             3ms  wrote 1.1.0 to packages/core/package.json and 1.0.1 to packages/cli/package.json (and @x/core@^1.1.0)
  ✔ @x/core  write              fs/write-changes             1ms  created packages/core/CHANGELOG.md
  ✔ @x/cli   write              fs/write-changes             1ms  created packages/cli/CHANGELOG.md
  ✔ *        stage              git/commit                  40ms  committed 5e1f00d
  ✔ *        release            git/create-tag              90ms  tagged @x/core@1.1.0 and @x/cli@1.0.1 at 5e1f00d and pushed to origin
  ✔ @x/core  release            npm/publish                1.20s  published @x/core@1.1.0 to https://registry.npmjs.org/ as latest
  ✔ @x/cli   release            npm/publish                1.10s  published @x/cli@1.0.1 to https://registry.npmjs.org/ as latest
```

The pipeline is the same as for one package. What changes is what each step runs for:

- Most steps run **once per component**, dependencies first. `conventional/read-commits` only counts the commits that touch the component's directory, leaving out the directories of components inside it. Paths in options, like `fs/write-changes`'s `CHANGELOG.md`, are relative to the component's directory.
- Some steps run **once for all components** together: `git/commit` makes one commit, `git/create-tag` pushes every tag in one atomic push, and `fs/write-version` points dependencies on released packages at their new versions, with the `npm`, `dart` and `cargo` formats.
- [`components/dependents`](reference/components/dependents.md) releases what depends on a released component, as at least a fix (`kind`), for releases of the kinds in `on`. Each release's notes end with a **Dependencies** section listing the components it depends on that were released with it, e.g. `- @x/core 1.0.0 → 1.1.0`, so a release made only for its dependencies says why.
- A component with nothing to release drops out after `determine-kind`. The run is `released` if any component was.

Each component is tagged `{name}@{version}`; set `tag` to change that, with `{name}` in it. Packages released under one shared version are a single component, like crates that set `version.workspace = true`, which `cargo/workspaces` leaves out, with `fs/write-version`'s `path` set to each `package.json`, e.g. `packages/*/package.json`. Components can also be listed by hand:

```yaml
components: |
  - { name: core, path: packages/core }
  - { name: cli, path: packages/cli, dependsOn: [core] }
  - { name: app, path: apps/web, scheme: calver, tag: "app-{version}" }
```

Each component can have its own `scheme`, `tag` and `history`. The `components` output lists every component's version and status, and `released-components` names those released, for a matrix of later jobs. Pass a job's `component` along with `version` to run its `release` steps for that component alone.
