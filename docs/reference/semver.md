# `semver`

Scheme: set it as the release's `scheme`.

`MAJOR.minor.patch` by the kind: breaking, feature or fix; `0.MAJOR.minorOrPatch` before 1.0.0.

## Options

| Option | Type | Default | |
|---|---|---|---|
| `shiftPreMajor` | `boolean` | `true` | Before 1.0.0, bump breaking changes as minor and features as patch. |
| `initial` | `string` | `0.1.0` | The first version, when there's no previous one. |

[All steps, schemes and sources](README.md)
