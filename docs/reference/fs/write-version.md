# `fs/write-version`

Step, in the `write` phase.

Writes each component's new version to its version file: `VERSION`, `package.json`, `Cargo.toml`, `pyproject.toml`, `pubspec.yaml`, a gem's `version.rb`, a `.csproj`, `Chart.yaml`, `gradle.properties`, `pom.xml`, or any file by pattern. With `npm`, `cargo` and `dart`, it also updates dependencies on the other components released with it, and needs `version.semver`; with `dart`, a build number like Flutter's `+3` is incremented. Runs once for all components.

## Options

| Option | Type | Default | |
|---|---|---|---|
| `format` | `plain \| npm \| cargo \| python \| dart \| ruby \| dotnet \| helm \| gradle \| maven \| pattern` | `plain` | `plain` (the whole file), `npm`, `cargo`, `python`, `dart`, `ruby`, `dotnet`, `helm`, `gradle`, `maven`, or `pattern`. |
| `path` | `string \| string[]` |  | Relative to each component's directory; globs, or a list, write several, e.g. `packages/*/package.json` for packages sharing a version. Defaults to the format's file. |
| `pattern` | `string` |  | With the `pattern` format, where the version is, e.g. `__version__ = "{version}"`. |

[All steps, schemes and sources](../README.md)
