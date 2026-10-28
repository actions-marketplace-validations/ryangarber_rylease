# `github/create-release`

Step, in the `release` phase.

Creates a GitHub release of the tag with the notes, unless it already has one; the tag is created at HEAD if it doesn't exist. Needs a token with `contents: write`.

## Options

| Option | Type | Default | |
|---|---|---|---|
| `title` | `string` | `{tag}` | `{tag}`, `{version}`, `{name}` and the scheme's placeholders are filled in. |
| `draft` | `boolean` | `false` |  |
| `prerelease` | `boolean \| auto` | `auto` | `auto` marks releases on a prerelease channel. |
| `repo` | `string` |  | `owner/repo`; defaults to `GITHUB_REPOSITORY` or the `origin` remote. |
| `token` | `string` |  | Defaults to `GITHUB_TOKEN` or `GH_TOKEN`. |

## In presets

- `change-files`
- `conventional`
- `conventional-pr`
- `keep-a-changelog`

[All steps, schemes and sources](../README.md)
