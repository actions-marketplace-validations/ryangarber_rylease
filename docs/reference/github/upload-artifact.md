# `github/upload-artifact`

Step, in the `release` phase.

Uploads files as a workflow artifact. Only works in the GitHub Action.

## Options

| Option | Type | Default | |
|---|---|---|---|
| `name` | `string` | required | The artifact's name, unique in the run; `{version}`, `{tag}` and the other placeholders are filled in. |
| `files` | `string[]` | required | Paths, globs or directories, relative to the component's directory unless absolute; each must match. |
| `dryRunArtifact` | `boolean` | `false` | Upload in dry runs too. |
| `retentionDays` | `integer` |  | Defaults to the repository's setting. |

[All steps, schemes and sources](../README.md)
