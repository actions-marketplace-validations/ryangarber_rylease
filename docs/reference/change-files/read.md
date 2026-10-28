# `change-files/read`

Step, in the `read-changes` phase.

Collects the change files in `.changes/`, each naming the components it changes and how much, e.g. `core: feature`; each change is labeled with its kind. Runs once for all components. Provides `changes.title`, `changes.labels`.

## Options

| Option | Type | Default | |
|---|---|---|---|
| `directory` | `string` | `.changes` | Where change files are kept, relative to the project. |

## In presets

- `change-files`

[All steps, schemes and sources](../README.md)
