# `calver`

Scheme: set it as the release's `scheme`.

Dates the version, as on calver.org, e.g. `YYYY.MM.MICRO` → `2026.10.0`; a counter numbers releases in the same period, bumped by the kind.

## Options

| Option | Type | Default | |
|---|---|---|---|
| `format` | `string` | `YYYY.MM.MICRO` | Tokens joined by `.`: `YYYY`, `YY`, `0Y`, `MM`, `0M`, `WW`, `0W`, `DD`, `0D` (ISO 8601 weeks, with the ISO year), and the counters `MAJOR`, `MINOR`, `MICRO`. Zero-padded tokens (`0M` …) aren't valid semver, which npm needs. |
| `timezone` | `string` | `UTC` | Where the release date is taken, e.g. `America/New_York`. |

[All steps, schemes and sources](README.md)
