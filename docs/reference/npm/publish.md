# `npm/publish`

Step, in the `release` phase.

Publishes the component's package to the npm registry with `npm` or `pnpm publish`; components are published dependencies first. Needs `version.semver`.

## Options

| Option | Type | Default | |
|---|---|---|---|
| `path` | `string` | `.` | The package's directory, relative to the component's. |
| `client` | `npm \| pnpm` |  | Defaults to the `packageManager` in package.json, then `pnpm` if there's a `pnpm-lock.yaml`, then `npm`. |
| `tag` | `string` |  | The dist-tag; defaults to the channel's name on a channel, then `publishConfig.tag`, or `latest`. |
| `access` | `public \| restricted` |  | Defaults to `publishConfig.access`. |
| `provenance` | `boolean` | `false` | Publishes with a provenance statement; needs `id-token: write`. |
| `registry` | `string` |  | Defaults to `publishConfig.registry`, or the npm registry. |
| `token` | `string` |  | Defaults to `NPM_TOKEN` or `NODE_AUTH_TOKEN`; without one, the client's own auth is used, e.g. trusted publishing. |

[All steps, schemes and sources](../README.md)
