# `cargo/workspaces`

Components: set it as the release's `components`.

Each crate of the Cargo workspace with its own `version`, the root's too, named after it and depending on the workspace crates it depends on.

## Options

| Option | Type | Default | |
|---|---|---|---|
| `private` | `boolean` | `false` | Include crates with `publish = false`. |
| `exclude` | `string[]` | `[]` | Crates to leave out, by name. |

[All steps, schemes and sources](../README.md)
