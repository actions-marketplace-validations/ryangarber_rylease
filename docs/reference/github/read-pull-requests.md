# `github/read-pull-requests`

Step, in the `read-changes` phase.

Collects the pull requests merged into the branch by the commits touching the component since the previous release, with their labels. Needs a token that can read pull requests. Provides `changes.title`, `changes.labels`, `changes.link`.

## Options

| Option | Type | Default | |
|---|---|---|---|
| `repo` | `string` |  | `owner/repo`; defaults to `GITHUB_REPOSITORY` or the `origin` remote. |
| `token` | `string` |  | Defaults to `GITHUB_TOKEN` or `GH_TOKEN`. |

[All steps, schemes and sources](../README.md)
