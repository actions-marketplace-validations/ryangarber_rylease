# `git/commit`

Step, in the `stage` phase.

Commits the files earlier release steps changed, for every component, in one commit. Runs once for all components.

## Options

| Option | Type | Default | |
|---|---|---|---|
| `files` | `string[]` | `[]` | More files to commit, relative to the working directory. |
| `message` | `string` | `chore(release): {tags}` | The commit message; `{tags}` is filled in with every release's tag, and with one component, its placeholders too, e.g. `{version}`. |
| `push` | `string \| false` | `false` | The remote to push the branch to; `false` leaves it to a later step, e.g. `git/create-tag`, so the commit and tag land together. |

## In presets

- `change-files`
- `keep-a-changelog`

[All steps, schemes and sources](../README.md)
