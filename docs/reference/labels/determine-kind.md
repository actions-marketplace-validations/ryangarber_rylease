# `labels/determine-kind`

Step, in the `determine-kind` phase.

By each change's labels, e.g. a pull request's (`breaking` → breaking, `enhancement` → feature, anything else → fix). The highest kind wins. Needs `changes.labels`.

## Options

| Option | Type | Default | |
|---|---|---|---|
| `kinds` | `{ [key]: breaking \| feature \| fix \| none }` | `{ breaking: breaking, semver:major: breaking, feature: feature, enhancement: feature, semver:minor: feature }` | Kinds by label, ignoring case. |
| `fallback` | `breaking \| feature \| fix \| none` | `fix` | The kind of a change without a label in `kinds`. |

## In presets

- `change-files`, with `{ kinds: { breaking: breaking, feature: feature, fix: fix, none: none } }`
- `keep-a-changelog`, with `{ kinds: { Removed: breaking, Added: feature, Changed: feature, Deprecated: feature } }`

[All steps, schemes and sources](../README.md)
