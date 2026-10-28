# `keep-a-changelog/write-release`

Step, in the `write` phase.

Moves the entries under `## [Unreleased]` to a heading for the version, and updates the compare links, if there are any.

## Options

| Option | Type | Default | |
|---|---|---|---|
| `path` | `string` | `CHANGELOG.md` | Relative to the component's directory. |
| `heading` | `string` | `## [{version}] - {date}` | `{version}`, `{tag}` and `{name}` (the component's) are filled in, and the scheme's own, e.g. `{major}`, `{minor}` and `{patch}`, and `{date}` (YYYY-MM-DD). |
| `channels` | `boolean` | `false` | Also run for releases on a channel, e.g. prereleases; by default only stable releases do. |

## In presets

- `keep-a-changelog`

[All steps, schemes and sources](../README.md)
