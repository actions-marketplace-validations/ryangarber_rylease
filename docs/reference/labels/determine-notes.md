# `labels/determine-notes`

Step, in the `determine-notes` phase.

A `### Title` section per group of labels, e.g. `### Bug Fixes` for `bug`, then `### Other` for everything else. Needs `changes.labels`.

## Options

| Option | Type | Default | |
|---|---|---|---|
| `sections` | `{ title: string, labels: string[] }[]` | `[{ title: Breaking Changes, labels: [breaking, semver:major] }, { title: Features, labels: [feature, enhancement] }, { title: Bug Fixes, labels: [bug, fix] }]` | Sections in order; a change goes in the first with one of its labels, ignoring case. |
| `other` | `string \| false` | `Other` | The section for remaining changes; `false` leaves them out. |
| `exclude` | `string[]` | `[skip-changelog]` | Changes with any of these labels are left out. |
| `descriptions` | `boolean` | `false` | Write each change's description, indented, under it. |
| `links` | `boolean` | `true` | Link each change to its source, e.g. its pull request. |
| `dependencies` | `string \| false` | `Dependencies` | The last section, for the components it depends on that were released along with it; `false` leaves it out. |

## In presets

- `change-files`, with `{ sections: [{ title: Breaking Changes, labels: [breaking] }, { title: Features, labels: [feature] }, { title: Fixes, labels: [fix] }], other: false, exclude: [none], descriptions: true }`
- `keep-a-changelog`, with `{ sections: [{ title: Added, labels: [Added] }, { title: Changed, labels: [Changed] }, { title: Deprecated, labels: [Deprecated] }, { title: Removed, labels: [Removed] }, { title: Fixed, labels: [Fixed] }, { title: Security, labels: [Security] }], descriptions: true }`

[All steps, schemes and sources](../README.md)
