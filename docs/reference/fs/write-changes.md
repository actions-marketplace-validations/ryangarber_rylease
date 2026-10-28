# `fs/write-changes`

Step, in the `write` phase.

Writes a heading and the notes to a file.

## Options

| Option | Type | Default | |
|---|---|---|---|
| `path` | `string` | `CHANGELOG.md` | Relative to the component's directory. |
| `heading` | `string` | `## {tag} ({date})` | `{version}`, `{tag}` and `{name}` (the component's) are filled in, and the scheme's own, e.g. `{major}`, `{minor}` and `{patch}`, and `{date}` (YYYY-MM-DD). |
| `mode` | `prepend \| append \| replace` | `prepend` |  |
| `channels` | `boolean` | `false` | Also run for releases on a channel, e.g. prereleases; by default only stable releases do. |

## In presets

- `change-files`
- `conventional-pr`

[All steps, schemes and sources](../README.md)
