# Reference

Generated from the definitions by `pnpm build:docs`. For how they fit together, see the [README](../../README.md).

## Steps

Listed in `steps`, in any order; they run by phase.

| Name | |
|---|---|
| [`change-files/read`](change-files/read.md) | Collects the change files in `.changes/`, each naming the components it changes and how much, e.g. `core: feature`; each change is labeled with its kind. |
| [`conventional/read-commits`](conventional/read-commits.md) | Collects each conventional section (`feat:`, `fix(x)!:` …) of every commit touching the component since the previous release, or in all history without one. |
| [`github/read-pull-requests`](github/read-pull-requests.md) | Collects the pull requests merged into the branch by the commits touching the component since the previous release, with their labels. Needs a token that can read pull requests. |
| [`keep-a-changelog/read-unreleased`](keep-a-changelog/read-unreleased.md) | Collects each entry under `## [Unreleased]` in a Keep a Changelog file, labeled with its `### Added`, `### Fixed` … heading. |
| [`components/dependents`](components/dependents.md) | Releases each component that depends on a released one, as at least a `fix`; list it after the steps that determine kinds. |
| [`conventional/determine-kind`](conventional/determine-kind.md) | `!` or `BREAKING` → breaking; otherwise by conventional type (`feat` → feature, anything else → fix). The highest kind wins. |
| [`labels/determine-kind`](labels/determine-kind.md) | By each change's labels, e.g. a pull request's (`breaking` → breaking, `enhancement` → feature, anything else → fix). The highest kind wins. |
| [`conventional/determine-notes`](conventional/determine-notes.md) | `### Breaking Changes`, `### Features`, `### Bug Fixes`, `### Performance Improvements` and `### Reverts` sections, then `### Other` for everything else. |
| [`labels/determine-notes`](labels/determine-notes.md) | A `### Title` section per group of labels, e.g. `### Bug Fixes` for `bug`, then `### Other` for everything else. |
| [`change-files/clean`](change-files/clean.md) | Deletes the change files of the components being released, for `git/commit` to commit; releases on a channel leave them for the stable release. |
| [`fs/write-changes`](fs/write-changes.md) | Writes a heading and the notes to a file. |
| [`fs/write-version`](fs/write-version.md) | Writes each component's new version to its version file: `VERSION`, `package.json`, `Cargo.toml`, `pyproject.toml`, `pubspec.yaml`, a gem's `version.rb`, a `.csproj`, `Chart.yaml`, `gradle.properties`, `pom.xml`, or any file by pattern. With `npm`, `cargo` and `dart`, it also updates dependencies on the other components released with it, and needs `version.semver`; with `dart`, a build number like Flutter's `+3` is incremented. |
| [`keep-a-changelog/write-release`](keep-a-changelog/write-release.md) | Moves the entries under `## [Unreleased]` to a heading for the version, and updates the compare links, if there are any. |
| [`git/commit`](git/commit.md) | Commits the files earlier release steps changed, for every component, in one commit. |
| [`github/open-release-pr`](github/open-release-pr.md) | Commits the prepared release to a branch and opens a pull request for it, or updates the open one; the release waits until it merges. Use with the `github/release-pr` history. List it after the `write` steps, in place of `git/commit`. |
| [`cargo/publish`](cargo/publish.md) | Publishes the component's crate to crates.io, or another registry, with `cargo publish`; components are published dependencies first. |
| [`dart/publish`](dart/publish.md) | Publishes the component's package to pub.dev, or its `publish_to` server, with `dart` or `flutter pub publish`; components are published dependencies first. |
| [`dotnet/publish`](dotnet/publish.md) | Pushes the component's packed `.nupkg` packages of the release's version to nuget.org, or another source, with `dotnet nuget push`. |
| [`git/create-tag`](git/create-tag.md) | Tags HEAD with each release's tag and pushes them, along with the branch, in one atomic push. |
| [`github/create-release`](github/create-release.md) | Creates a GitHub release of the tag with the notes, unless it already has one; the tag is created at HEAD if it doesn't exist. Needs a token with `contents: write`. |
| [`github/upload-artifact`](github/upload-artifact.md) | Uploads files as a workflow artifact. Only works in the GitHub Action. |
| [`github/upload-release-assets`](github/upload-release-assets.md) | Uploads files to the GitHub release, creating it (with the notes) if no other job has yet. |
| [`gitlab/create-release`](gitlab/create-release.md) | Creates a GitLab release of the tag with the notes, unless it already has one; the tag is created at HEAD if it doesn't exist. |
| [`npm/publish`](npm/publish.md) | Publishes the component's package to the npm registry with `npm` or `pnpm publish`; components are published dependencies first. |
| [`python/publish`](python/publish.md) | Uploads the component's built wheels and sdists of the release's version to PyPI, or another index, with `uv publish` or `twine upload`. |
| [`ruby/publish`](ruby/publish.md) | Packs the component's gem with `gem build` and pushes it to RubyGems, or another host, with `gem push`. |
| [`exec/command`](exec/command.md) | Runs a command for each component in its `phase`: `write` e.g. to update a lockfile, listing what it changes as `files`, or `release` e.g. `cargo publish` or `docker push app:{version}`. |

## Schemes

Set as the release's `scheme`.

| Name | |
|---|---|
| [`calver`](calver.md) | Dates the version, as on calver.org, e.g. `YYYY.MM.MICRO` → `2026.10.0`; a counter numbers releases in the same period, bumped by the kind. |
| [`semver`](semver.md) | `MAJOR.minor.patch` by the kind: breaking, feature or fix; `0.MAJOR.minorOrPatch` before 1.0.0. |

## Histories

Set as the release's `history`: where the previous release is found.

| Name | |
|---|---|
| [`fs/version-file`](fs/version-file.md) | The version in the project's version file, in any format `fs/write-version` writes, released at the commit that set it. |
| [`git/tags`](git/tags.md) | The nearest release tag on HEAD: the highest version among the tags no other release tag comes after. On a channel, its own releases count too. |
| [`github/release-pr`](github/release-pr.md) | A release proposed by a release pull request from `github/open-release-pr`, once it's merged; otherwise the nearest release tag on HEAD, as `git/tags`. |

## Components

Set as the release's `components`: what's versioned, in a monorepo.

| Name | |
|---|---|
| [`cargo/workspaces`](cargo/workspaces.md) | Each crate of the Cargo workspace with its own `version`, the root's too, named after it and depending on the workspace crates it depends on. |
| [`dart/workspaces`](dart/workspaces.md) | Each package of the pub or Melos workspace with a `version`, the root's too, named after it and depending on the workspace packages it depends on. |
| [`npm/workspaces`](npm/workspaces.md) | Each package of the npm, Yarn or pnpm workspace, named after it and depending on the workspace packages it depends on. |
