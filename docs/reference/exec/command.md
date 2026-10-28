# `exec/command`

Step, in the `write`, `stage` or `release` phase, as its `phase` option picks.

Runs a command for each component in its `phase`: `write` e.g. to update a lockfile, listing what it changes as `files`, or `release` e.g. `cargo publish` or `docker push app:{version}`.

## Options

| Option | Type | Default | |
|---|---|---|---|
| `phase` | `write \| stage \| release` | required | The phase it runs in. |
| `command` | `string \| string[]` | required | `{placeholders}` are filled in. Text runs in `sh -c`; a list runs as it is, without a shell. |
| `dryRun` | `string \| string[]` |  | Runs instead in a dry run, e.g. `cargo publish --dry-run`; without it, a dry run only says what it would run. |
| `cwd` | `string` | `.` | Where it runs, relative to the component's directory. |
| `env` | `{ [key]: string }` | `{}` | More environment variables, with `{placeholders}` filled in. |
| `files` | `string[]` | `[]` | What it changes, relative to the component's directory, for `git/commit`. |

[All steps, schemes and sources](../README.md)
