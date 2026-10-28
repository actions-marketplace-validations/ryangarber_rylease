# `conventional/determine-kind`

Step, in the `determine-kind` phase.

`!` or `BREAKING` → breaking; otherwise by conventional type (`feat` → feature, anything else → fix). The highest kind wins.

## Options

| Option | Type | Default | |
|---|---|---|---|
| `types` | `{ [key]: breaking \| feature \| fix \| none }` | `{}` | Kinds by `type` or `type(scope)`, on top of `feat: feature`, e.g. `{ docs: none, chore(deps): fix }`. |
| `fallback` | `breaking \| feature \| fix \| none` | `fix` | The kind of any other change, untyped ones included. |

## In presets

- `conventional`
- `conventional-pr`

[All steps, schemes and sources](../README.md)
