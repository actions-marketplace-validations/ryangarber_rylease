# `change-files/clean`

Step, in the `write` phase.

Deletes the change files of the components being released, for `git/commit` to commit; releases on a channel leave them for the stable release. Runs once for all components.

## Options

| Option | Type | Default | |
|---|---|---|---|
| `directory` | `string` | `.changes` | Where change files are kept, relative to the project. |
| `channels` | `boolean` | `false` | Also run for releases on a channel, e.g. prereleases; by default only stable releases do. |

## In presets

- `change-files`

[All steps, schemes and sources](../README.md)
