# rylease

A release pipeline that doesn't fight you.

Everything is a **step**: a small, named, strictly typed function that does one auditable thing and says why. Steps run in a fixed order of phases. Each one receives the environment, your own context, and the outputs of every step before it.

```
read-version → read-changes → determine-kind → determine-version → determine-notes → write → stage → release
```

rylease handles `read-version` and `determine-version` itself. It finds the previous release with the release's **history**, e.g. the nearest tag on HEAD, and works out the next version with its **scheme**, e.g. semver, on a **channel** if there is one, e.g. `2.0.0-next.1`. Both come from the preset, unless the release sets its own; there are no other defaults. No step parses or bumps a version; every step takes it as plain text. `write` steps change files, `stage` steps commit them (or propose them in a pull request), and `release` steps ship the result.

Nothing assumes semver, npm or GitHub, and each of them is one line to add. Every step declares its options once, and they work the same in a config file as in TypeScript. Steps also declare what they **need** and **provide**, e.g. `labels/determine-kind` needs changes with labels. A release that can't work fails before anything runs, and the error says which step would fix it.

## GitHub Actions

```yaml
permissions:
  contents: write
steps:
  - uses: actions/checkout@v7
    with:
      fetch-depth: 0 # full history is needed to find the previous release
  - uses: ryangarber/rylease@v3
```

That runs the bundled `conventional` preset, which versions by semver and finds the previous release by its tag. To configure it, or add more steps, use `steps`: a list shaped like a workflow's. Each entry `uses` a step or preset, gives it options `with`, and may run only `if` an expression holds.

```yaml
  - uses: ryangarber/rylease@v3
    with:
      steps: |
        - uses: conventional
          with:
            github/create-release: { draft: true }
            conventional/determine-kind:
              types: { docs: none, chore: none, "chore(deps)": fix }
        - uses: ./.github/release/announce.ts
          if: "!dryRun && kind != 'fix'"
          with:
            channel: "#releases"
```

```
rylease release · main · /home/runner/work/project/project

  ✔ read-version       git/tags                     4ms    v1.0.0 at 0d92bfa, nearest on HEAD
  ✔ read-changes       conventional/read-commits    12ms   3 changes in 2 commits since 0d92bfa
  ✔ determine-kind     conventional/determine-kind  <1ms   'feat' in title (commit 3a7a7e3)
  ✔ determine-version  semver                       <1ms   1.1.0: 'feature' from 1.0.0, bumps minor
  ✔ determine-notes        conventional/determine-notes     <1ms   feature release; features: 1, bug fixes: 1, other: 1
  ✔ release            git/create-tag               92ms   tagged v1.1.0 at 3a7a7e3 and pushed to origin
  ✔ release            github/create-release        410ms  created release v1.1.0: https://github.com/me/project/releases/tag/v1.1.0
  ✔ release            announce                     130ms  announced 1.1.0 in #releases

  1.0.0 → 1.1.0 (feature) · released
```

- **`uses`** names a bundled step or preset, a path to a file (`./release/announce.ts`, its default export), or an installed package (`some-package`, or `some-package#namedExport`). `.ts` files run as they are; they can `import { defineStep, z } from "rylease"` without installing it.
- **`with`** holds the options. A preset takes options for each of its steps by name, and `false` leaves a step out, for instance to replace it with your own, or to list it again with an `if`. Listing a step that a preset already has is an error, so nothing runs twice by accident.
- **`if`** runs the step only when an expression holds; see [Conditions](#conditions). On a preset, it applies to each of its steps.
- **Options** are checked before anything runs. A typo fails the job with its exact location, e.g. `steps[0].with.git/create-tag: Unrecognized key: "pushh"`.

The same keys can live in a config file instead: `rylease.yml`, `.github/rylease.yml`, or `rylease.config.ts` exporting a release made with `defineRelease`. The action, the [CLI](#cli-gitlab-and-other-ci) and other CI all read it, and the action's inputs override its keys.

```yaml
# rylease.yml
steps:
  - uses: conventional
channels:
  next: { branches: [next] }
```

| Input | Default | |
|---|---|---|
| `steps` | `- uses: conventional` | The steps, as above. |
| `scheme` | the preset's | How versions look and are bumped: `semver`, `calver`, or with options, `{ uses: calver, with: { format: YY.MINOR.MICRO } }`. Needed when no preset provides one. See [Schemes](#schemes). |
| `tag` | `v{version}` | Each release's tag. With several components, `{name}@{version}`. |
| `history` | the preset's | Where the previous release is found: `git/tags`, or a list tried in turn, e.g. `[git/tags, { uses: fs/version-file, with: { format: npm } }]`. Needed when no preset provides one. |
| `components` | the whole project | What's versioned, for monorepos: `npm/workspaces`, or a list. See [Monorepos](#monorepos). |
| `channels` | none | Prerelease and build channels, e.g. `{ next: { branches: [next] } }`. See [Channels](#channels). |
| `channel` | | The channel to release on, e.g. `nightly`; by default the first whose branches match. |
| `config` | the first that exists | A config file with any of the keys above. |
| `dry-run` | `false` | Runs every step without side effects; each reports what it would do. |
| `version` | | A version that's already been worked out, e.g. by an earlier job: only the `release` steps run, for it. |
| `notes` | | The release notes, along with `version`. |
| `component` | | The component `version` is for, when there are several. |
| `working-directory` | `.` | The project to release. |
| `summary` | `true` | Writes the release, a row per step and the notes to the job's summary page. |
| `token` | `${{ github.token }}` | Used when `GITHUB_TOKEN` isn't set. |

Outputs: `status` (`released`, `pending` when a [release pull request](#release-pull-requests) is proposed, `unchanged` or `failed`), `released` (`true`/`false`), `previous-version`, `version`, `kind` (`breaking`, `feature`, `fix` or `none`), `notes`, `channel` and `prerelease`. There's also `components`, each component's values as JSON, and `released-components`, a JSON list of the names of those released, e.g. for a matrix.

### Conditions

`if` is evaluated just before the step would run, so it can depend on what earlier steps did:

```yaml
- uses: npm/publish
  if: "!dryRun && !prerelease"
- uses: ./release/announce.ts
  if: kind == 'breaking' || contains(notes, 'security')
- uses: ./release/link.ts
  if: steps['github/create-release'].output.url != null
```

| Name | |
|---|---|
| `dryRun`, `branch`, `cwd` | The run's environment. |
| `channel`, `prerelease` | The channel released on, or `null`, and whether it's a prerelease channel. |
| `previousVersion`, `previousRef`, `previousTag`, `changes`, `kind`, `version`, `tag`, `notes`, `dependencies` | The release so far; a value is `null` until its phase has run. |
| `component` | The component the step runs for: `component.name` and `component.path`. |
| `components` | For steps that run once for all components: each one's values. |
| `steps['<name>']` | Each step that ran before: its `phase`, `status` (`ok` or `skipped`), `reason` and `output`. Names with a `/` need brackets, e.g. `steps['git/commit'].output`; others can also be read as `steps.announce`. |

Expressions are written like GitHub's: `'strings'` (`''` for a quote), numbers, `true`, `false` and `null`; `.name` and `['name']`; `!`, `==`, `!=`, `<`, `<=`, `>`, `>=`, `&&`, `||` and parentheses; and `contains(text or list, value)`, `startsWith(text, prefix)` and `endsWith(text, suffix)`. Comparisons are exact, and case-sensitive. An `if` starting with `!` needs quotes in YAML.

GitHub fills in `${{ ... }}` in `steps` before rylease reads it, so `if: ${{ github.event_name == 'workflow_dispatch' }}` works too and becomes `if: true` or `if: false`. If conditions skip every step of a phase, the next phase fails, since it has nothing to go on.

In TypeScript, a condition is a function of what the step receives: `when(steps.npmPublish(), ({ env }) => !env.dryRun)`.

### Node projects

`conventional` works from git tags alone, in any project. To also keep the version in `package.json` and a `CHANGELOG.md`, add the steps that write them, and `git/commit` to commit what they change. Steps run by phase, so the order you list them in doesn't matter:

```yaml
  - uses: ryangarber/rylease@v3
    with:
      history: "[git/tags, { uses: fs/version-file, with: { format: npm } }]"
      steps: |
        - uses: conventional
        - uses: fs/write-version
          with: { format: npm }
        - uses: fs/write-changes
        - uses: git/commit
```

`history` finds the previous release from its tag. A project that's never been tagged falls back to the version in `package.json`, released at the commit that set it. If there's neither, every commit counts and the release is the scheme's first (`0.1.0` for semver, set with `initial`).

`git/commit` and `git/create-tag` each have a `push` option, off by default. `conventional` sets it on `git/create-tag` alone, which pushes the branch along with the tags in one atomic push, so the release commit and its tag land together or not at all.

### Publishing to npm

Add `npm/publish` too. It publishes with `pnpm` or `npm`, whichever the project uses, so lifecycle scripts like `prepublishOnly` run as usual. Install dependencies first, and set up pnpm if the project uses it.

```yaml
permissions:
  contents: write
  id-token: write # for trusted publishing, or provenance
steps:
  - uses: actions/checkout@v7
    with:
      fetch-depth: 0
  - uses: pnpm/setup@v3 # installs dependencies too
  - uses: ryangarber/rylease@v3
    with:
      steps: |
        - uses: conventional
        - uses: fs/write-version
          with: { format: npm }
        - uses: git/commit
        - uses: npm/publish
    env:
      NPM_TOKEN: ${{ secrets.NPM_TOKEN }} # not needed with trusted publishing
```

It publishes the version that `fs/write-version` wrote, after the release is committed, tagged and pushed, and refuses to publish any other. On a channel, it publishes under the channel's dist-tag, e.g. `next`. npm only takes semantic versions, so both steps need a scheme that makes them; with `calver` and a zero-padded format like `YYYY.0M.MICRO`, the release fails before anything runs.

### Other ecosystems

`fs/write-version` writes the version wherever a project keeps it, keeping the rest of the file as it was, and `fs/version-file` reads it back as a history:

| `format` | File | |
|---|---|---|
| `plain` | `VERSION` | The whole file. |
| `npm` | `package.json` | `version`, and dependencies on other released components. |
| `cargo` | `Cargo.toml` | `version` in `[package]` or `[workspace.package]`, and `version`s of dependencies on other released crates. |
| `python` | `pyproject.toml` | `version` in `[project]` or `[tool.poetry]`. |
| `helm` | `Chart.yaml` | The chart's `version`. |
| `gradle` | `gradle.properties` | `version=`. |
| `maven` | `pom.xml` | The project's own `<version>`, not its parent's or its dependencies'. |
| `pattern` | any | Wherever a template matches, e.g. `pattern: '__version__ = "{version}"'`, or `appVersion: "{version}"` in `Chart.yaml`. |

`exec/command` runs any command, with `{placeholders}` filled in, in the `phase` it's given: in `write`, e.g. to update a lockfile, and in `release` to ship it. In a dry run it only says what it'd run, unless it's given a `dryRun` command to run instead.

```yaml
- uses: conventional
- uses: fs/write-version
  with: { format: cargo }
- uses: exec/command
  with: { phase: write, command: cargo update --workspace, files: [Cargo.lock] }
- uses: git/commit
- uses: exec/command
  with:
    phase: release
    command: cargo publish
    dryRun: cargo publish --dry-run
    env: { CARGO_REGISTRY_TOKEN: "${{ secrets.CARGO_TOKEN }}" }
- uses: exec/command
  with: { phase: release, command: "docker buildx build --push -t ghcr.io/me/app:{version} ." }
```

### Uploading builds to the release

Jobs that build after the release, say one per platform, can each upload their files to it. Pass the version (and notes) the release job worked out, and only the `release` steps run. Here the `release` job passes on rylease's `released`, `version` and `notes` outputs, and whether it was a dry run, as its own outputs:

```yaml
  build:
    needs: release
    if: needs.release.outputs.released == 'true'
    strategy:
      matrix:
        os: [macos-latest, ubuntu-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v7
        with:
          ref: v${{ needs.release.outputs.version }}
      - run: npm ci && npm run build
      - uses: ryangarber/rylease@v3
        with:
          version: ${{ needs.release.outputs.version }}
          notes: ${{ needs.release.outputs.notes }}
          dry-run: ${{ needs.release.outputs.dry-run }}
          scheme: semver # no preset here to provide them
          history: git/tags
          steps: |
            - uses: github/upload-release-assets
              with:
                files: ["dist/app-*"]
                dryRunArtifact: true
```

`github/upload-release-assets` uploads to the release that `github/create-release` created, or creates it if no job has yet. When several jobs race to, the losers wait for the winner's release and use it. Failed requests and uploads are retried, and an upload that failed halfway is cleared first. With `dryRunArtifact`, a dry run keeps the files as a workflow artifact instead, so a dry run of the whole pipeline leaves every build to download. `github/upload-artifact` does the same for any files, in a dry run or not.

### Other sources and schemes

Each phase has more than one way to fill it. Leave a preset's step out with `false`, and list another in its place.

| Phase | `conventional` uses | Or |
|---|---|---|
| `read-changes` | `conventional/read-commits` | `github/read-pull-requests`, `keep-a-changelog/read-unreleased`, `change-files/read` |
| `determine-kind` | `conventional/determine-kind` | `labels/determine-kind`, `components/dependents` |
| `determine-notes` | `conventional/determine-notes` | `labels/determine-notes` |
| `write` | | `fs/write-version`, `fs/write-changes`, `keep-a-changelog/write-release`, `change-files/clean`, `exec/command` |
| `stage` | | `git/commit`, `github/open-release-pr` |
| `release` | `git/create-tag`, `github/create-release` | `gitlab/create-release`, `npm/publish`, `exec/command`, `github/upload-release-assets`, … |

Steps of neighboring phases work together as long as one provides what the other needs. The `labels/` steps need labels, which pull requests, Keep a Changelog sections and change files provide. The `conventional/` ones read conventional titles, from any source. Commits have no labels, so `labels/determine-kind` after `conventional/read-commits` fails before anything runs:

```
labels/determine-kind needs changes.labels, which conventional/read-commits doesn't provide; change-files/read, github/read-pull-requests or keep-a-changelog/read-unreleased do
```

Pull requests, by label, as GitHub's own release notes group them:

```yaml
- uses: conventional
  with:
    conventional/read-commits: false
    conventional/determine-kind: false
    conventional/determine-notes: false
- uses: github/read-pull-requests
- uses: labels/determine-kind # breaking → breaking, enhancement → feature, else fix
- uses: labels/determine-notes
```

If your pull request titles are conventional, keep `conventional/determine-kind` and `conventional/determine-notes`; they read titles whatever the source.

A hand-written [Keep a Changelog](https://keepachangelog.com) has its own preset, `keep-a-changelog`: it releases the `## [Unreleased]` section, labels each entry by its `### Added`, `### Fixed` … heading, and commits the changelog before tagging. Its sections don't imply a scheme, so set one, e.g. `scheme: semver`. Don't use it with `fs/write-changes`, since both write `CHANGELOG.md`.

On GitLab, replace `github/create-release` with `gitlab/create-release`. In GitLab CI, it takes the project, API and job token from the job. Branch detection, commit links and the identity that `git/commit` and `git/create-tag` use also come from GitLab's variables.

### Change files

Commit messages don't always say what a release should. With change files, whoever makes a change says what it is and how much it changes each component, in a file under `.changes/`:

```md
---
"@x/core": feature
"@x/cli": fix
---
Add dark mode.

It follows the system's setting.
```

`rylease add --component @x/core:feature --component @x/cli "Add dark mode"` writes one; in a project that's one component, `kind: feature` stands for it. The `change-files` preset releases what the files say. It notes each change under its kind, deletes the files it released in the release commit, and tags and releases as `conventional` does. Kinds don't imply a scheme, so set one. A file naming a component that doesn't exist, or a kind that isn't one, fails the release before anything runs.

```yaml
# rylease.yml
scheme: semver
steps:
  - uses: change-files
```

### Schemes

A release's kind says how much changed, whatever the scheme: `breaking`, `feature`, `fix`, or `none` for nothing to release. The scheme decides what each kind bumps. It's also the one place that recognizes and orders versions, so finding the previous release, bumping and tagging always agree.

`semver` bumps `MAJOR.minor.patch`; `conventional` and `conventional-pr` use it, since conventional commits are defined by it. Before 1.0.0 it shifts bumps down a level (`0.MAJOR.minorOrPatch`) unless `shiftPreMajor` is off.

Calendar versions, from conventional commits:

```yaml
- uses: ryangarber/rylease@v3
  with:
    scheme: "{ uses: calver, with: { format: YYYY.MM.MICRO } }" # 2026.10.0, 2026.10.1, … 2026.11.0
    steps: |
      - uses: conventional
        with:
          git/create-tag: { move: ["v{YYYY}.{MM}"] } # v2026.10, the month's latest
```

`calver` takes the date from the clock, in UTC unless you set `timezone`. Its counters number the releases of a period, and the kind picks which: in `YY.MINOR.MICRO`, a fix bumps `MICRO` and a feature `MINOR`. In a new period they all start again from 0. A format without a counter, like `YYYY.0M.0D`, can release once per period. Its tokens are placeholders in templates, e.g. `{YYYY}`; every scheme also fills `{major}`, `{minor}` and `{patch}` with a version's first three numbers.

Switching schemes is safe. The previous release is still found, so changes start from it, but a version from another scheme isn't bumped: the next release is the new scheme's first.

A scheme of your own is an object with `matches`, `compare`, `bump` and optionally `fields`, `traits` and `formats` (for [channels](#channels)). Define it with `defineScheme`, like a step, to use it from a workflow too, as `scheme: ./.github/release/four-part.ts`:

```ts
// .github/release/four-part.ts: MAJOR.minor.patch.build, the build always counting up
import { defineScheme } from "rylease";

const numbers = (version: string) => version.split(".").map(Number);

export default defineScheme({
	name: "four-part",
	create: () => ({
		name: "four-part",
		matches: (version) => /^\d+\.\d+\.\d+\.\d+$/.test(version),
		compare: (a, b) => {
			const [x, y] = [numbers(a), numbers(b)];
			return x.reduce((order, n, i) => order || n - (y[i] ?? 0), 0);
		},
		bump: ({ previous = "0.0.0.0", kind }) => {
			const [major = 0, minor = 0, patch = 0, build = 0] = numbers(previous);
			const next = {
				breaking: [major + 1, 0, 0],
				feature: [major, minor + 1, 0],
				fix: [major, minor, patch + 1],
			}[kind];
			return { version: [...next, build + 1].join("."), reason: `bumps ${kind}` };
		},
	}),
});
```

`determine-kind` steps can also set the version outright, e.g. from a `Release-As:` footer, by returning `version` with the kind; the scheme still checks it.

### Channels

A channel releases versions that lead up to the next stable one, or number builds of the last, whatever the scheme: `2.0.0-next.1`, `2026.10.0-beta.2`, `1.4.0+nightly.7`. Each channel wraps the scheme's version in a format with a counter:

```yaml
channels:
  next: { branches: [next] }                         # 2.0.0-next.1, 2.0.0-next.2, …
  beta: { branches: ["beta/*"], format: "{version}-beta.{n}" }
  nightly: { type: build }                           # 1.4.0+nightly.1; with channel: nightly
```

A run releases on the channel it's given (the `channel` input or `--channel`), or else on the first whose `branches` match, or else as a stable release.

- A **prerelease** (`type: prerelease`, the default) leads up to the version its changes would bump the last stable release to. Its counter continues across runs, and across branches, so two never share a version. A bigger change moves it on to a bigger version, and starts the counter again.
- A **build** (`type: build`) numbers builds of the last stable release, e.g. nightlies.
- A **stable** release ignores channel releases, so merging `next` into `main` releases `2.0.0` with every change since `1.4.0`.

The default formats are `{version}-{channel}.{n}` and `{version}+{channel}.{n}`; a scheme can have its own, e.g. `{version}rc{n}` for Python's. On a channel, `github/create-release` marks prereleases, and `npm/publish` publishes under the channel's dist-tag. `git/create-tag` only moves `move` tags that name `{channel}`, e.g. a floating `next` tag; the others, like `v{major}`, wait for the stable release. `fs/write-changes`, `keep-a-changelog/write-release` and `change-files/clean` leave the changelog and change files for the stable release, unless they're given `channels: true`.

### Release pull requests

Instead of releasing on every push, rylease can propose the release in a pull request, kept up to date as changes land, and release it when it's merged:

```yaml
  - uses: ryangarber/rylease@v3
    with:
      steps: |
        - uses: conventional-pr
        - uses: fs/write-version
          with: { format: npm }
```

On a push, `github/open-release-pr` commits what the `write` steps changed to `rylease/main`, and opens a pull request for it, or updates the open one. Its body holds each release's notes. The run is `pending`, and nothing is tagged. When the pull request is merged, the next run finds it through `conventional-pr`'s history, `github/release-pr`: only the `release` steps run, for the versions and notes it proposed. The job needs `pull-requests: write` as well as `contents: write`.

### Monorepos

A release has one or more **components**: what's versioned and released together, under one version and one tag. Without `components`, the whole project is one. In a monorepo, each package is usually one, and `npm/workspaces` finds them in an npm, Yarn or pnpm workspace:

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
- Some steps run **once for all components** together: `git/commit` makes one commit, `git/create-tag` pushes every tag in one atomic push, and `fs/write-version` points dependencies on released packages at their new versions.
- `components/dependents` releases what depends on a released component, as at least a fix (`kind`), for releases of the kinds in `on`. Each release's notes end with a **Dependencies** section listing the components it depends on that were released with it, e.g. `- @x/core 1.0.0 → 1.1.0`, so a release made only for its dependencies says why.
- A component with nothing to release drops out after `determine-kind`. The run is `released` if any component was.

Each component is tagged `{name}@{version}`; set `tag` to change that, with `{name}` in it. Packages released under one shared version are a single component, with `fs/write-version`'s `path` set to each `package.json`, e.g. `packages/*/package.json`. Components can also be listed by hand:

```yaml
components: |
  - { name: core, path: packages/core }
  - { name: cli, path: packages/cli, dependsOn: [core] }
  - { name: app, path: apps/web, scheme: calver, tag: "app-{version}" }
```

Each component can have its own `scheme`, `tag` and `history`. The `components` output lists every component's version and status, and `released-components` names those released, for a matrix of later jobs. Pass a job's `component` along with `version` to run its `release` steps for that component alone.

## CLI, GitLab and other CI

`npx rylease` runs the release in the config file, or `conventional` without one, anywhere:

```sh
npx rylease --dry-run                # what would be released, and why
npx rylease --channel next           # release on a channel
npx rylease --release 1.2.0 --notes "…"   # run only the release steps, e.g. in a later job
npx rylease add --component core:feature "Add dark mode"   # a change file
```

`--json` prints the report as JSON, `--summary <file>` appends the Markdown summary, and `--outputs <file>` writes the action's outputs as `RYLEASE_STATUS=released` lines, e.g. for a GitLab dotenv report:

```yaml
release:
  image: node:24
  script:
    - npx rylease --outputs release.env
  artifacts:
    reports:
      dotenv: release.env
```

## TypeScript

The same release, as a script:

```ts
// release.ts
import { defineRelease, presets, schemes, sources } from "rylease";

await defineRelease({
	scheme: schemes.semver({ initial: "1.0.0" }),
	history: [sources.gitTags(), sources.fsVersionFile({ format: "npm" })],
	channels: { next: { branches: ["next"] } },
	steps: [
		...presets.conventional({
			"github/create-release": { draft: true },
			"conventional/determine-kind": { types: { docs: "none", chore: "none" } },
		}),
		announce({ channel: "#releases" }),
	],
})
	.run({ dryRun: process.argv.includes("--dry-run") })
	.catch(() => {
		process.exitCode = 1; // the failure has already been printed
	});
```

Export the release as the default export of `rylease.config.ts` instead, and the action and the CLI run it. `markdownSummary(report)` renders a report as the Markdown the action writes to the job summary.

## Steps

| Type | Receives (plus `component`, `previousVersion?`, `previousRef?`, `previousTag?`, `env`, `context`, `history`) | Returns |
|---|---|---|
| `read-changes` | `changes?` | `{ changes: { title?, description?, reason, link?, labels? }[], reason }` |
| `determine-kind` | … `changes`, `kind?` | `{ kind: "breaking" \| "feature" \| "fix" \| "none", version?, reason }` |
| `determine-notes` | … `kind` (never `"none"`), `version`, `tag`, `placeholders`, `dependencies`, `notes?` | `{ notes, reason }` |
| `write`, `stage` | … `notes`, `releases` (results of earlier `write`, `stage` and `release` steps) | `{ output, files?, defer?, reason }` |
| `release` | … `notes`, `releases` | `{ output, files?, reason }` |

- **Order.** Steps are sorted by phase. Steps of the same phase keep the order you gave them.
- **Chaining.** When several steps share a phase, each later one receives the current value as an optional input (e.g. `notes?`). Whatever it returns replaces that value. `write`, `stage` and `release` outputs accumulate instead.
- **One source of truth.** A step takes what it needs from earlier phases and never works it out again. `previousRef` is the commit of the previous release, and changes are collected from there. `tag` is the release's tag, and `placeholders` fill templates. `files` lists what a `write` step changed, and `git/commit` commits exactly those.
- **Scope.** A step runs once per component (`scope: "each"`, the default) or once for all of them (`scope: "all"`). Then it receives `components`, each with what it would receive on its own, and returns `results` by component name, or from `write` on, one result for all.
- **Facts.** A step declares the facts it `needs` and `provides`, e.g. `changes.labels`: every change has labels. Before anything runs, each need must be met by an earlier step, or for `version.semver`, by the scheme. Provided facts are checked on the step's output. Facts about changes last only until another step replaces the changes. `needs` can also be a function of the step's options, e.g. by format.
- **Deferring.** A `write` or `stage` step that returns `defer` leaves the release to later: the `release` steps are skipped with that reason, and the run is `pending`.
- **Nothing to release.** A component whose final kind is `"none"` drops out; if none are left, the remaining steps are skipped.
- **Dry run.** Steps get `env.dryRun`. Steps with side effects must do nothing and explain what they *would* have done. The one exception is `dryRunArtifact`, which keeps files as an artifact of the workflow run, which only that run sees.
- **Audit.** `run()` resolves to a report with a record (phase, name, component, status, duration, reason, output) for every step, and for the previous and next versions. On failure it rejects with a `ReleaseError` whose `.report` holds the same records.

### Custom steps

`defineStep` declares a step and its options, as a [zod](https://zod.dev) shape. The result is a factory: call it with options to get a step. Options are typed from the shape, and validated on every call, whether they come from TypeScript or from a workflow file. Use `.default()` for optional options, and `.describe()` to document them.

```ts
// .github/release/announce.ts
import { defineStep, z } from "rylease";

export default defineStep({
	phase: "release",
	name: "announce",
	description: "Posts the release to Slack.",
	options: {
		channel: z.string().describe("Where to post."),
		mention: z.boolean().default(false),
	},
	run: async ({ version, env, options }) => {
		if (env.dryRun) return { output: null, reason: `would announce in ${options.channel}` };
		await postToSlack(options.channel, `Released ${version}`);
		return { output: null, reason: `announced ${version} in ${options.channel}` };
	},
});
```

`needs` types the step's input accordingly, and `provides` its output:

```ts
export const byJira = defineStep({
	phase: "determine-kind",
	name: "jira/determine-kind",
	needs: ["changes.labels"],
	run: ({ changes }) => ({
		// `labels` is `string[]` here, never undefined.
		kind: changes.some((change) => change.labels.includes("epic")) ? "feature" : "fix",
		reason: "by Jira labels",
	}),
});
```

Add facts of your own by declaration merging: `declare module "rylease" { interface Facts { "changes.jira": true } }`.

Steps that run git can use `git(env.cwd, ...args)`, which resolves with its trimmed output and fails with git's own error, or `tryGit`, which resolves with `undefined` instead of failing.

`definePreset({ name, steps })` bundles factories, like `presets.conventional`, and takes options per step by name. It can also give the `scheme` and `history` of releases made with it, as factories, e.g. `history: sources.gitTags`; a release's own wins, and two presets that both give one are an error. `defineHistory` and `defineComponents` define where previous releases and components come from, the same way.

Steps given inline to `defineRelease` are plain `{ phase, name, run }` objects, typed from their `phase` and `scope`.

### Context

`context` holds whatever state you want to share between inline steps, and its type is yours. It is the only place for arbitrary state, and the bundled steps never touch it.

```ts
defineRelease<{ slackTs?: string }>({
	context: {},
	steps: [
		...presets.conventional(),
		{
			phase: "release",
			name: "announce",
			run: async ({ version, context, env }) => {
				if (env.dryRun) return { output: null, reason: "would announce" };
				context.slackTs = await postToSlack(`Released ${version}`);
				return { output: context.slackTs, reason: "posted to #releases" };
			},
		},
	],
});
```

## Migrating from v2

| v2 | v3 |
|---|---|
| `git/read-tag` | `history: git/tags`, which the presets give: the previous release is the nearest tag on HEAD, so a `1.x` branch finds its own. Set its template with the release's `tag`. |
| `npm/read-version`, `fs/read-version` | `history: [git/tags, { uses: fs/version-file, with: { format: npm } }]` (or `format: plain` for a `VERSION` file). |
| `npm/write-version` | `fs/write-version` with `format: npm`. |
| `version/bump-semver` | `scheme: semver`, which `conventional` and `conventional-pr` give, with the same `shiftPreMajor`. |
| `version/calver` | `scheme: { uses: calver, with: { format: … } }`. |
| Kinds `major`, `minor`, `patch` | `breaking`, `feature`, `fix`, in options (`types: { docs: none, "chore(deps)": fix }`), conditions and outputs. |
| `tag` options of `git/create-tag`, `github/create-release`, `gitlab/create-release`, `github/upload-release-assets`, `keep-a-changelog/write-release` | The release's `tag`, set once. Templates get `{tag}`; `git/commit`'s message is `chore(release): {tags}`. |
| Listing steps that write files before a preset | Not needed: `fs/write-*` steps are `write` steps and `git/commit` a `stage` step, so they run in order wherever they're listed. Custom steps that change files should be `write` steps. |
| `working-directory` per package | `components: npm/workspaces`, in one run. |
| Steps of type `read-version` or `bump-version` | A history (`defineHistory`) or scheme (`defineScheme`). |

## Bundled steps

Presets, with the scheme and history they give:

| Preset | Steps | `scheme` | `history` |
|---|---|---|---|
| `conventional` | The first five below, in this order. | `semver` | `git/tags` |
| `conventional-pr` | `conventional`'s, with `fs/write-changes` and `github/open-release-pr`. | `semver` | `github/release-pr` |
| `keep-a-changelog` | `keep-a-changelog/read-unreleased`, `labels/determine-kind`, `labels/determine-notes`, `keep-a-changelog/write-release`, `git/commit`, `git/create-tag`, `github/create-release`. | | `git/tags` |
| `change-files` | `change-files/read`, `labels/determine-kind`, `labels/determine-notes`, `change-files/clean`, `fs/write-changes`, `git/commit`, `git/create-tag`, `github/create-release`. | | `git/tags` |

Each step is also exported on its own (`steps.gitCreateTag`, …).

<!-- options:start -->
#### `conventional/read-commits` · `read-changes`

Collects each conventional section (`feat:`, `fix(x)!:` …) of every commit touching the component since the previous release, or in all history without one. Provides `changes.title`.

No options.

#### `conventional/determine-kind` · `determine-kind`

`!` or `BREAKING` → breaking; otherwise by conventional type (`feat` → feature, anything else → fix). The highest kind wins.

| Option | Type | Default | |
|---|---|---|---|
| `types` | `{ [key]: breaking \| feature \| fix \| none }` | `{}` | Kinds by `type` or `type(scope)`, on top of `feat: feature`, e.g. `{ docs: none, chore(deps): fix }`. |
| `fallback` | `breaking \| feature \| fix \| none` | `fix` | The kind of any other change, untyped ones included. |

#### `conventional/determine-notes` · `determine-notes`

`### Breaking Changes`, `### Features`, `### Bug Fixes`, `### Performance Improvements` and `### Reverts` sections, then `### Other` for everything else.

| Option | Type | Default | |
|---|---|---|---|
| `sections` | `{ title: string, types: string[] }[]` | `[{ title: Features, types: [feat] }, { title: Bug Fixes, types: [fix] }, { title: Performance Improvements, types: [perf] }, { title: Reverts, types: [revert] }]` | Sections in order; a change goes in the first that lists its type. |
| `breaking` | `string \| false` | `Breaking Changes` | The first section, for breaking changes of any type; `false` marks them **(breaking)** in their own section instead. |
| `other` | `string \| false` | `Other` | The section for remaining changes; `false` leaves them out. |
| `links` | `boolean` | `true` | Link each change to its source, e.g. its commit. |
| `dependencies` | `string \| false` | `Dependencies` | The last section, for the components it depends on that were released along with it; `false` leaves it out. |

#### `git/create-tag` · `release`

Tags HEAD with each release's tag and pushes them, along with the branch, in one atomic push. Runs once for all components.

| Option | Type | Default | |
|---|---|---|---|
| `message` | `string` | `chore(release): {tag}` | The tag message; `{version}`, `{tag}` and `{name}` (the component's) are filled in, and the scheme's own, e.g. `{major}`, `{minor}` and `{patch}`. |
| `move` | `string[]` | `[]` | Tags to create or move to each release, e.g. `v{major}`; force-pushed. Those with `{channel}` only move on a channel, e.g. to `next`, and the others only on stable releases. |
| `push` | `string \| false` | `origin` in `conventional`, `false` on its own | The remote to push the tags and the current branch to; `false` skips pushing. |

#### `github/create-release` · `release`

Creates a GitHub release of the tag with the notes, unless it already has one; the tag is created at HEAD if it doesn't exist. Needs a token with `contents: write`.

| Option | Type | Default | |
|---|---|---|---|
| `title` | `string` | `{tag}` | `{tag}`, `{version}`, `{name}` and the scheme's placeholders are filled in. |
| `draft` | `boolean` | `false` |  |
| `prerelease` | `boolean \| auto` | `auto` | `auto` marks releases on a prerelease channel. |
| `repo` | `string` |  | `owner/repo`; defaults to `GITHUB_REPOSITORY` or the `origin` remote. |
| `token` | `string` |  | Defaults to `GITHUB_TOKEN` or `GH_TOKEN`. |

### More steps

These aren't in `conventional`; list them with it, or in its place: see [Other sources and schemes](#other-sources-and-schemes). Steps run by phase, so they can be listed in any order; steps of the same phase run in the order given.

#### `change-files/clean` · `write`

Deletes the change files of the components being released, for `git/commit` to commit; releases on a channel leave them for the stable release. Runs once for all components.

| Option | Type | Default | |
|---|---|---|---|
| `directory` | `string` | `.changes` | Where change files are kept, relative to the project. |
| `channels` | `boolean` | `false` | Also run for releases on a channel, e.g. prereleases; by default only stable releases do. |

#### `change-files/read` · `read-changes`

Collects the change files in `.changes/`, each naming the components it changes and how much, e.g. `core: feature`; each change is labeled with its kind. Runs once for all components. Provides `changes.title`, `changes.labels`.

| Option | Type | Default | |
|---|---|---|---|
| `directory` | `string` | `.changes` | Where change files are kept, relative to the project. |

#### `components/dependents` · `determine-kind`

Releases each component that depends on a released one, as at least a `fix`; list it after the steps that determine kinds. Runs once for all components.

| Option | Type | Default | |
|---|---|---|---|
| `kind` | `breaking \| feature \| fix` | `fix` | The least kind of a dependent's release. |
| `on` | `breaking \| feature \| fix[]` | `[breaking, feature, fix]` | The kinds of a dependency's release that release its dependents. |

#### `exec/command` · `write | stage | release`

Runs a command for each component in its `phase`: `write` e.g. to update a lockfile, listing what it changes as `files`, or `release` e.g. `cargo publish` or `docker push app:{version}`.

| Option | Type | Default | |
|---|---|---|---|
| `phase` | `write \| stage \| release` | required | The phase it runs in. |
| `command` | `string \| string[]` | required | `{placeholders}` are filled in. Text runs in `sh -c`; a list runs as it is, without a shell. |
| `dryRun` | `string \| string[]` |  | Runs instead in a dry run, e.g. `cargo publish --dry-run`; without it, a dry run only says what it would run. |
| `cwd` | `string` | `.` | Where it runs, relative to the component's directory. |
| `env` | `{ [key]: string }` | `{}` | More environment variables, with `{placeholders}` filled in. |
| `files` | `string[]` | `[]` | What it changes, relative to the component's directory, for `git/commit`. |

#### `fs/write-changes` · `write`

Writes a heading and the notes to a file.

| Option | Type | Default | |
|---|---|---|---|
| `path` | `string` | `CHANGELOG.md` | Relative to the component's directory. |
| `heading` | `string` | `## {tag} ({date})` | `{version}`, `{tag}` and `{name}` (the component's) are filled in, and the scheme's own, e.g. `{major}`, `{minor}` and `{patch}`, and `{date}` (YYYY-MM-DD). |
| `mode` | `prepend \| append \| replace` | `prepend` |  |
| `channels` | `boolean` | `false` | Also run for releases on a channel, e.g. prereleases; by default only stable releases do. |

#### `fs/write-version` · `write`

Writes each component's new version to its version file: `VERSION`, `package.json`, `Cargo.toml`, `pyproject.toml`, `Chart.yaml`, `gradle.properties`, `pom.xml`, or any file by pattern. With `npm` and `cargo`, it also updates dependencies on the other components released with it, and needs `version.semver`. Runs once for all components.

| Option | Type | Default | |
|---|---|---|---|
| `format` | `plain \| npm \| cargo \| python \| helm \| gradle \| maven \| pattern` | `plain` | `plain` (the whole file), `npm`, `cargo`, `python`, `helm`, `gradle`, `maven`, or `pattern`. |
| `path` | `string \| string[]` |  | Relative to each component's directory; globs, or a list, write several, e.g. `packages/*/package.json` for packages sharing a version. Defaults to the format's file. |
| `pattern` | `string` |  | With the `pattern` format, where the version is, e.g. `__version__ = "{version}"`. |

#### `git/commit` · `stage`

Commits the files earlier release steps changed, for every component, in one commit. Runs once for all components.

| Option | Type | Default | |
|---|---|---|---|
| `files` | `string[]` | `[]` | More files to commit, relative to the working directory. |
| `message` | `string` | `chore(release): {tags}` | The commit message; `{tags}` is filled in with every release's tag, and with one component, its placeholders too, e.g. `{version}`. |
| `push` | `string \| false` | `false` | The remote to push the branch to; `false` leaves it to a later step, e.g. `git/create-tag`, so the commit and tag land together. |

#### `github/open-release-pr` · `stage`

Commits the prepared release to a branch and opens a pull request for it, or updates the open one; the release waits until it merges. Use with the `github/release-pr` history. List it after the `write` steps, in place of `git/commit`. Runs once for all components.

| Option | Type | Default | |
|---|---|---|---|
| `branch` | `string` | `rylease/{branch}` | The release branch, force-pushed; `{branch}` is the branch being released. |
| `title` | `string` | `chore(release): {tags}` | The commit message and title; `{tags}` lists every release's tag. |
| `labels` | `string[]` | `[rylease: pending]` | Labels for the pull request; `github/release-pr` looks for the first. |
| `remote` | `string` | `origin` | Where to push the branch. |
| `repo` | `string` |  | `owner/repo`; defaults to `GITHUB_REPOSITORY` or the `origin` remote. |
| `token` | `string` |  | Defaults to `GITHUB_TOKEN` or `GH_TOKEN`; needs `pull-requests: write`. |

#### `github/read-pull-requests` · `read-changes`

Collects the pull requests merged into the branch by the commits touching the component since the previous release, with their labels. Needs a token that can read pull requests. Provides `changes.title`, `changes.labels`, `changes.link`.

| Option | Type | Default | |
|---|---|---|---|
| `repo` | `string` |  | `owner/repo`; defaults to `GITHUB_REPOSITORY` or the `origin` remote. |
| `token` | `string` |  | Defaults to `GITHUB_TOKEN` or `GH_TOKEN`. |

#### `github/upload-artifact` · `release`

Uploads files as a workflow artifact. Only works in the GitHub Action.

| Option | Type | Default | |
|---|---|---|---|
| `name` | `string` | required | The artifact's name, unique in the run; `{version}`, `{tag}` and the other placeholders are filled in. |
| `files` | `string[]` | required | Paths, globs or directories, relative to the component's directory unless absolute; each must match. |
| `dryRunArtifact` | `boolean` | `false` | Upload in dry runs too. |
| `retentionDays` | `integer` |  | Defaults to the repository's setting. |

#### `github/upload-release-assets` · `release`

Uploads files to the GitHub release, creating it (with the notes) if no other job has yet.

| Option | Type | Default | |
|---|---|---|---|
| `files` | `string[]` | required | Paths or globs, relative to the component's directory unless absolute; each must match. |
| `clobber` | `boolean` | `true` | Replace assets of the same name. |
| `dryRunArtifact` | `boolean` | `false` | In dry runs, keep the files as a workflow artifact instead; only in the GitHub Action. |
| `artifactName` | `string` |  | Unique in the run; `{version}`, `{tag}` and the other placeholders are filled in. Defaults to the asset's name, or for several, a name made from theirs. |
| `title` | `string` | `{tag}` | `{tag}`, `{version}`, `{name}` and the scheme's placeholders are filled in. |
| `draft` | `boolean` | `false` |  |
| `prerelease` | `boolean \| auto` | `auto` | `auto` marks releases on a prerelease channel. |
| `repo` | `string` |  | `owner/repo`; defaults to `GITHUB_REPOSITORY` or the `origin` remote. |
| `token` | `string` |  | Defaults to `GITHUB_TOKEN` or `GH_TOKEN`. |

#### `gitlab/create-release` · `release`

Creates a GitLab release of the tag with the notes, unless it already has one; the tag is created at HEAD if it doesn't exist.

| Option | Type | Default | |
|---|---|---|---|
| `title` | `string` | `{tag}` | `{tag}`, `{version}`, `{name}` and the scheme's placeholders are filled in. |
| `project` | `string` |  | The project's ID or path, e.g. `group/project`; defaults to `CI_PROJECT_ID`. |
| `token` | `string` |  | Defaults to `GITLAB_TOKEN`, then the job's `CI_JOB_TOKEN`. |

#### `keep-a-changelog/read-unreleased` · `read-changes`

Collects each entry under `## [Unreleased]` in a Keep a Changelog file, labeled with its `### Added`, `### Fixed` … heading. Provides `changes.title`, `changes.labels`.

| Option | Type | Default | |
|---|---|---|---|
| `path` | `string` | `CHANGELOG.md` | Relative to the component's directory. |

#### `keep-a-changelog/write-release` · `write`

Moves the entries under `## [Unreleased]` to a heading for the version, and updates the compare links, if there are any.

| Option | Type | Default | |
|---|---|---|---|
| `path` | `string` | `CHANGELOG.md` | Relative to the component's directory. |
| `heading` | `string` | `## [{version}] - {date}` | `{version}`, `{tag}` and `{name}` (the component's) are filled in, and the scheme's own, e.g. `{major}`, `{minor}` and `{patch}`, and `{date}` (YYYY-MM-DD). |
| `channels` | `boolean` | `false` | Also run for releases on a channel, e.g. prereleases; by default only stable releases do. |

#### `labels/determine-notes` · `determine-notes`

A `### Title` section per group of labels, e.g. `### Bug Fixes` for `bug`, then `### Other` for everything else. Needs `changes.labels`.

| Option | Type | Default | |
|---|---|---|---|
| `sections` | `{ title: string, labels: string[] }[]` | `[{ title: Breaking Changes, labels: [breaking, semver:major] }, { title: Features, labels: [feature, enhancement] }, { title: Bug Fixes, labels: [bug, fix] }]` | Sections in order; a change goes in the first with one of its labels, ignoring case. |
| `other` | `string \| false` | `Other` | The section for remaining changes; `false` leaves them out. |
| `exclude` | `string[]` | `[skip-changelog]` | Changes with any of these labels are left out. |
| `descriptions` | `boolean` | `false` | Write each change's description, indented, under it. |
| `links` | `boolean` | `true` | Link each change to its source, e.g. its pull request. |
| `dependencies` | `string \| false` | `Dependencies` | The last section, for the components it depends on that were released along with it; `false` leaves it out. |

#### `labels/determine-kind` · `determine-kind`

By each change's labels, e.g. a pull request's (`breaking` → breaking, `enhancement` → feature, anything else → fix). The highest kind wins. Needs `changes.labels`.

| Option | Type | Default | |
|---|---|---|---|
| `kinds` | `{ [key]: breaking \| feature \| fix \| none }` | `{ breaking: breaking, semver:major: breaking, feature: feature, enhancement: feature, semver:minor: feature }` | Kinds by label, ignoring case. |
| `fallback` | `breaking \| feature \| fix \| none` | `fix` | The kind of a change without a label in `kinds`. |

#### `npm/publish` · `release`

Publishes the component's package to the npm registry with `npm` or `pnpm publish`; components are published dependencies first. Needs `version.semver`.

| Option | Type | Default | |
|---|---|---|---|
| `path` | `string` | `.` | The package's directory, relative to the component's. |
| `client` | `npm \| pnpm` |  | Defaults to the `packageManager` in package.json, then `pnpm` if there's a `pnpm-lock.yaml`, then `npm`. |
| `tag` | `string` |  | The dist-tag; defaults to the channel's name on a channel, then `publishConfig.tag`, or `latest`. |
| `access` | `public \| restricted` |  | Defaults to `publishConfig.access`. |
| `provenance` | `boolean` | `false` | Publishes with a provenance statement; needs `id-token: write`. |
| `registry` | `string` |  | Defaults to `publishConfig.registry`, or the npm registry. |
| `token` | `string` |  | Defaults to `NPM_TOKEN` or `NODE_AUTH_TOKEN`; without one, the client's own auth is used, e.g. trusted publishing. |

### Bundled schemes

Set one as the release's `scheme`; see [Schemes](#schemes).

#### `calver` · `scheme`

Dates the version, as on calver.org, e.g. `YYYY.MM.MICRO` → `2026.10.0`; a counter numbers releases in the same period, bumped by the kind.

| Option | Type | Default | |
|---|---|---|---|
| `format` | `string` | `YYYY.MM.MICRO` | Tokens joined by `.`: `YYYY`, `YY`, `0Y`, `MM`, `0M`, `WW`, `0W`, `DD`, `0D` (ISO 8601 weeks, with the ISO year), and the counters `MAJOR`, `MINOR`, `MICRO`. Zero-padded tokens (`0M` …) aren't valid semver, which npm needs. |
| `timezone` | `string` | `UTC` | Where the release date is taken, e.g. `America/New_York`. |

#### `semver` · `scheme`

`MAJOR.minor.patch` by the kind: breaking, feature or fix; `0.MAJOR.minorOrPatch` before 1.0.0.

| Option | Type | Default | |
|---|---|---|---|
| `shiftPreMajor` | `boolean` | `true` | Before 1.0.0, bump breaking changes as minor and features as patch. |
| `initial` | `string` | `0.1.0` | The first version, when there's no previous one. |

### Bundled sources

Where previous releases are found, set as `history`, and what's released, set as `components`.

#### `fs/version-file` · `history`

The version in the project's version file, in any format `fs/write-version` writes, released at the commit that set it.

| Option | Type | Default | |
|---|---|---|---|
| `format` | `plain \| npm \| cargo \| python \| helm \| gradle \| maven \| pattern` | `plain` | As for `fs/write-version`. |
| `path` | `string` |  | Relative to the component's directory; defaults to the format's file. |
| `pattern` | `string` |  | With the `pattern` format, where the version is. |

#### `git/tags` · `history`

The nearest release tag on HEAD: the highest version among the tags no other release tag comes after. On a channel, its own releases count too.

No options.

#### `github/release-pr` · `history`

A release proposed by a release pull request from `github/open-release-pr`, once it's merged; otherwise the nearest release tag on HEAD, as `git/tags`.

| Option | Type | Default | |
|---|---|---|---|
| `label` | `string` | `rylease: pending` | The label of release pull requests not yet released. |
| `repo` | `string` |  | `owner/repo`; defaults to `GITHUB_REPOSITORY` or the `origin` remote. |
| `token` | `string` |  | Defaults to `GITHUB_TOKEN` or `GH_TOKEN`. |

### Bundled components

Where components are found, set as `components`.

#### `npm/workspaces` · `components`

Each package of the npm, Yarn or pnpm workspace, named after it and depending on the workspace packages it depends on.

| Option | Type | Default | |
|---|---|---|---|
| `private` | `boolean` | `false` | Include packages marked `private`. |
| `exclude` | `string[]` | `[]` | Packages to leave out, by name. |
<!-- options:end -->
