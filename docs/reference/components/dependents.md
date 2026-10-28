# `components/dependents`

Step, in the `determine-kind` phase.

Releases each component that depends on a released one, as at least a `fix`; list it after the steps that determine kinds. Runs once for all components.

## Options

| Option | Type | Default | |
|---|---|---|---|
| `kind` | `breaking \| feature \| fix` | `fix` | The least kind of a dependent's release. |
| `on` | `breaking \| feature \| fix[]` | `[breaking, feature, fix]` | The kinds of a dependency's release that release its dependents. |

[All steps, schemes and sources](../README.md)
