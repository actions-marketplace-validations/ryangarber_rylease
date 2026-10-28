# rylease

A release pipeline that doesn't fight you.

Everything is a **step**: a small, named, strictly typed function that does one auditable thing and says why. Steps run in a fixed order of phases. Each one receives the environment, your own context, and the outputs of every step before it.

Nothing assumes semver, npm or GitHub, and each of them is one line to add. Every step declares its options once, and they work the same in a config file as in TypeScript. Steps also declare what they **need** and **provide**, e.g. `labels/determine-kind` needs changes with labels. A release that can't work fails before anything runs, and the error says which step would fix it.

## Quick start

```yaml
permissions:
  contents: write
steps:
  - uses: actions/checkout@v7
    with:
      fetch-depth: 0 # full history is needed to find the previous release
  - uses: ryangarber/rylease@v3
```

That runs the bundled [`conventional`](#presets) preset: conventional commits since the last tag become a semver version, a git tag and a GitHub release.

```
rylease release · main · /home/runner/work/project/project

  ✔ read-version       git/tags                     4ms    v1.0.0 at 0d92bfa, nearest on HEAD
  ✔ read-changes       conventional/read-commits    12ms   3 changes in 2 commits since 0d92bfa
  ✔ determine-kind     conventional/determine-kind  <1ms   'feat' in title (commit 3a7a7e3)
  ✔ determine-version  semver                       <1ms   1.1.0: 'feature' from 1.0.0, bumps minor
  ✔ determine-notes    conventional/determine-notes <1ms   feature release; features: 1, bug fixes: 1, other: 1
  ✔ release            git/create-tag               92ms   tagged v1.1.0 at 3a7a7e3 and pushed to origin
  ✔ release            github/create-release        410ms  created release v1.1.0: https://github.com/me/project/releases/tag/v1.1.0

  1.0.0 → 1.1.0 (feature) · released
```

Outside GitHub Actions, `npx rylease` does the same; see [CLI, GitLab and other CI](docs/cli.md).

## Phases

```
read-version → read-changes → determine-kind → determine-version → determine-notes → write → stage → release
```

| Phase | | Filled by |
|---|---|---|
| `read-version` | Finds the previous release: its version, commit and tag. | The release's **history**, e.g. `git/tags`. |
| `read-changes` | Collects what changed since then. | Steps, e.g. `conventional/read-commits`. |
| `determine-kind` | Decides how much changed: `breaking`, `feature`, `fix`, or `none` for nothing to release. | Steps, e.g. `conventional/determine-kind`. |
| `determine-version` | Bumps the previous version by the kind, on a **channel** if there is one, e.g. `2.0.0-next.1`. | The release's **scheme**, e.g. `semver`. |
| `determine-notes` | Writes the release notes. | Steps, e.g. `conventional/determine-notes`. |
| `write` | Changes files, e.g. the version in `package.json` or a changelog. | Steps, e.g. `fs/write-version`. |
| `stage` | Commits what `write` changed, or proposes it in a pull request. | Steps, e.g. `git/commit`. |
| `release` | Ships the result: tags, releases, packages. | Steps, e.g. `git/create-tag`, `npm/publish`. |

rylease handles `read-version` and `determine-version` itself, with the history and scheme. Both come from the preset, unless the release sets its own; there are no other defaults. No step parses or bumps a version; every step takes it as plain text.

Steps run by phase, so the order you list them in doesn't matter; steps of the same phase run in the order given, each receiving what the one before it produced.

## Configuring

`steps` is a list shaped like a workflow's: each entry `uses` a step or preset, gives it options `with`, and may run only `if` an expression holds. A preset takes options for each of its steps by name, and `false` leaves one out.

```yaml
  - uses: ryangarber/rylease@v3
    with:
      steps: |
        - uses: conventional
          with:
            github/create-release: { draft: true }
            conventional/determine-kind:
              types: { docs: none, chore: none, "chore(deps)": fix }
        - uses: fs/write-version
          with: { format: npm }
        - uses: git/commit
        - uses: npm/publish
          if: "!dryRun && !prerelease"
```

The same keys can live in `rylease.yml`, `.github/rylease.yml` or `rylease.config.ts`. Options are checked before anything runs, and a typo fails with its exact location. The action's inputs and outputs, config files and conditions are in [Configuration](docs/configuration.md).

## Presets

A preset is a list of steps used as one, with the scheme and history it needs. Every preset pushes the release's tag, along with the branch, to `origin` in one atomic push.

| Preset | Steps | `scheme` | `history` |
|---|---|---|---|
| `conventional` | `conventional/read-commits`, `conventional/determine-kind`, `conventional/determine-notes`, `git/create-tag`, `github/create-release` | `semver` | `git/tags` |
| `conventional-pr` | `conventional`'s, with `fs/write-changes` and `github/open-release-pr` | `semver` | `github/release-pr` |
| `keep-a-changelog` | `keep-a-changelog/read-unreleased`, `labels/determine-kind`, `labels/determine-notes`, `keep-a-changelog/write-release`, `git/commit`, `git/create-tag`, `github/create-release` | set one | `git/tags` |
| `change-files` | `change-files/read`, `labels/determine-kind`, `labels/determine-notes`, `change-files/clean`, `fs/write-changes`, `git/commit`, `git/create-tag`, `github/create-release` | set one | `git/tags` |

- **`conventional`** reads every [conventional commit](https://www.conventionalcommits.org) since the previous tag. `!` or `BREAKING` is breaking, `feat` a feature, and anything else a fix. The notes have `Breaking Changes`, `Features`, `Bug Fixes`, `Performance Improvements`, `Reverts` and `Other` sections. It tags HEAD and creates a GitHub release, and writes no files: it works from git tags alone, in any project.
- **`conventional-pr`** does the same, but instead of releasing on every push it writes `CHANGELOG.md` and proposes the release in a pull request, kept up to date as changes land; merging it tags and releases. See [Release pull requests](docs/release-pull-requests.md).
- **`keep-a-changelog`** releases the `## [Unreleased]` section of a hand-written [Keep a Changelog](https://keepachangelog.com). `Removed` entries are breaking, `Added`, `Changed` and `Deprecated` ones features, and the rest fixes. It moves the section under the new version, commits it, then tags and releases.
- **`change-files`** releases what the files in `.changes/` say, each naming the components it changes and how much. It notes each change under its kind, deletes the files in the release commit, writes `CHANGELOG.md`, then tags and releases. See [Other sources](docs/sources.md#change-files).

Sections don't imply a version scheme, so with `keep-a-changelog` and `change-files`, set `scheme`, e.g. `scheme: semver`. To keep the version in a project's own files or publish a package, add the steps for it alongside the preset; see [Ecosystems](docs/ecosystems.md).

## Docs

- [Configuration](docs/configuration.md): action inputs and outputs, config files, conditions.
- [Ecosystems](docs/ecosystems.md): version files and publishing for npm, Dart and Flutter, Cargo, Python, Ruby, .NET and more.
- [Other sources](docs/sources.md): pull requests, labels, Keep a Changelog, change files, GitLab.
- [Schemes](docs/schemes.md): semver, calendar versions, your own.
- [Channels](docs/channels.md): prereleases and builds.
- [Monorepos](docs/monorepos.md): components, released together or apart.
- [Release pull requests](docs/release-pull-requests.md)
- [Uploading builds](docs/uploading-builds.md): to the release, from later jobs.
- [CLI, GitLab and other CI](docs/cli.md), and testing workflows locally.
- [TypeScript](docs/typescript.md): releases as scripts, custom steps.
- [Migrating from v2](docs/migrating-from-v2.md)
- [Reference](docs/reference/README.md): every bundled step, scheme and source, with its options.
