# Other sources

Each phase has more than one way to fill it. Leave a preset's step out with `false`, and list another in its place.

| Phase | `conventional` uses | Or |
|---|---|---|
| `read-changes` | `conventional/read-commits` | `github/read-pull-requests`, `keep-a-changelog/read-unreleased`, `change-files/read` |
| `determine-kind` | `conventional/determine-kind` | `labels/determine-kind`, `components/dependents` |
| `determine-notes` | `conventional/determine-notes` | `labels/determine-notes` |
| `write` | | `fs/write-version`, `fs/write-changes`, `keep-a-changelog/write-release`, `change-files/clean`, `exec/command` |
| `stage` | | `git/commit`, `github/open-release-pr` |
| `release` | `git/create-tag`, `github/create-release` | `gitlab/create-release`, `npm/publish`, `exec/command`, `github/upload-release-assets`, … |

Every step is in the [reference](reference/README.md).

Steps of neighboring phases work together as long as one provides what the other needs. The `labels/` steps need labels, which pull requests, Keep a Changelog sections and change files provide. The `conventional/` ones read conventional titles, from any source. Commits have no labels, so `labels/determine-kind` after `conventional/read-commits` fails before anything runs:

```
labels/determine-kind needs changes.labels, which conventional/read-commits doesn't provide; change-files/read, github/read-pull-requests or keep-a-changelog/read-unreleased do
```

## Pull requests

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

## Keep a Changelog

A hand-written [Keep a Changelog](https://keepachangelog.com) has its own preset, `keep-a-changelog`: it releases the `## [Unreleased]` section, labels each entry by its `### Added`, `### Fixed` … heading, and commits the changelog before tagging. Its sections don't imply a scheme, so set one, e.g. `scheme: semver`. Don't use it with `fs/write-changes`, since both write `CHANGELOG.md`.

## Change files

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

## GitLab

On GitLab, replace `github/create-release` with `gitlab/create-release`. In GitLab CI, it takes the project, API and job token from the job. Branch detection, commit links and the identity that `git/commit` and `git/create-tag` use also come from GitLab's variables. See [CLI](cli.md) for running rylease there.
