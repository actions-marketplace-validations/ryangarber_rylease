# `github/release-pr`

History: set it as the release's `history`.

A release proposed by a release pull request from `github/open-release-pr`, once it's merged; otherwise the nearest release tag on HEAD, as `git/tags`.

## Options

| Option | Type | Default | |
|---|---|---|---|
| `label` | `string` | `rylease: pending` | The label of release pull requests not yet released. |
| `repo` | `string` |  | `owner/repo`; defaults to `GITHUB_REPOSITORY` or the `origin` remote. |
| `token` | `string` |  | Defaults to `GITHUB_TOKEN` or `GH_TOKEN`. |

[All steps, schemes and sources](../README.md)
