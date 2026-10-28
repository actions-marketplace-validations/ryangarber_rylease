# `dart/publish`

Step, in the `release` phase.

Publishes the component's package to pub.dev, or its `publish_to` server, with `dart` or `flutter pub publish`; components are published dependencies first. Needs `version.semver`.

## Options

| Option | Type | Default | |
|---|---|---|---|
| `path` | `string` | `.` | The package's directory, relative to the component's. |
| `client` | `dart \| flutter` |  | Defaults to `flutter` for packages that depend on the Flutter SDK, otherwise `dart`. |
| `token` | `string` |  | Defaults to `PUB_TOKEN`; it's added for the server with `pub token add --env-var PUB_TOKEN`, as `dart-lang/setup-dart` does. Without one, the client's own auth is used. |

[All steps, schemes and sources](../README.md)
