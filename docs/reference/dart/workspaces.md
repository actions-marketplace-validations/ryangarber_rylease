# `dart/workspaces`

Components: set it as the release's `components`.

Each package of the pub or Melos workspace with a `version`, the root's too, named after it and depending on the workspace packages it depends on.

## Options

| Option | Type | Default | |
|---|---|---|---|
| `private` | `boolean` | `false` | Include packages with `publish_to: none`, e.g. apps. |
| `exclude` | `string[]` | `[]` | Packages to leave out, by name. |

[All steps, schemes and sources](../README.md)
