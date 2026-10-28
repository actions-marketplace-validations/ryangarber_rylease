# `github/open-release-pr`

Step, in the `stage` phase.

Commits the prepared release to a branch and opens a pull request for it, or updates the open one; the release waits until it merges. Use with the `github/release-pr` history. List it after the `write` steps, in place of `git/commit`. Runs once for all components.

## Options

| Option | Type | Default | |
|---|---|---|---|
| `branch` | `string` | `rylease/{branch}` | The release branch, force-pushed; `{branch}` is the branch being released. |
| `title` | `string` | `chore(release): {tags}` | The commit message and title; `{tags}` lists every release's tag. |
| `labels` | `string[]` | `[rylease: pending]` | Labels for the pull request; `github/release-pr` looks for the first. |
| `remote` | `string` | `origin` | Where to push the branch. |
| `repo` | `string` |  | `owner/repo`; defaults to `GITHUB_REPOSITORY` or the `origin` remote. |
| `token` | `string` |  | Defaults to `GITHUB_TOKEN` or `GH_TOKEN`; needs `pull-requests: write`. |

## In presets

- `conventional-pr`

[All steps, schemes and sources](../README.md)
