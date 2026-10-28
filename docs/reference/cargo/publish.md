# `cargo/publish`

Step, in the `release` phase.

Publishes the component's crate to crates.io, or another registry, with `cargo publish`; components are published dependencies first. Needs `version.semver`.

## Options

| Option | Type | Default | |
|---|---|---|---|
| `path` | `string` | `.` | The crate's directory, relative to the component's. |
| `registry` | `string` |  | The name of a registry in Cargo's config; defaults to crates.io. |
| `token` | `string` |  | Defaults to `CARGO_REGISTRY_TOKEN`, or `CARGO_REGISTRIES_<NAME>_TOKEN` with a `registry`, which Cargo reads itself; without one, Cargo's own auth is used. |

[All steps, schemes and sources](../README.md)
