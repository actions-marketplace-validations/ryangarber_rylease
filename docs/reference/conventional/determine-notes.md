# `conventional/determine-notes`

Step, in the `determine-notes` phase.

`### Breaking Changes`, `### Features`, `### Bug Fixes`, `### Performance Improvements` and `### Reverts` sections, then `### Other` for everything else.

## Options

| Option | Type | Default | |
|---|---|---|---|
| `sections` | `{ title: string, types: string[] }[]` | `[{ title: Features, types: [feat] }, { title: Bug Fixes, types: [fix] }, { title: Performance Improvements, types: [perf] }, { title: Reverts, types: [revert] }]` | Sections in order; a change goes in the first that lists its type. |
| `breaking` | `string \| false` | `Breaking Changes` | The first section, for breaking changes of any type; `false` marks them **(breaking)** in their own section instead. |
| `other` | `string \| false` | `Other` | The section for remaining changes; `false` leaves them out. |
| `links` | `boolean` | `true` | Link each change to its source, e.g. its commit. |
| `dependencies` | `string \| false` | `Dependencies` | The last section, for the components it depends on that were released along with it; `false` leaves it out. |

## In presets

- `conventional`
- `conventional-pr`

[All steps, schemes and sources](../README.md)
