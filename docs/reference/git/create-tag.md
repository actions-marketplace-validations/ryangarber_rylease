# `git/create-tag`

Step, in the `release` phase.

Tags HEAD with each release's tag and pushes them, along with the branch, in one atomic push. Runs once for all components.

## Options

| Option | Type | Default | |
|---|---|---|---|
| `message` | `string` | `chore(release): {tag}` | The tag message; `{version}`, `{tag}` and `{name}` (the component's) are filled in, and the scheme's own, e.g. `{major}`, `{minor}` and `{patch}`. |
| `move` | `string[]` | `[]` | Tags to create or move to each release, e.g. `v{major}`; force-pushed. Those with `{channel}` only move on a channel, e.g. to `next`, and the others only on stable releases. |
| `push` | `string \| false` | `false` | The remote to push the tags and the current branch to; `false` skips pushing. |

## In presets

- `change-files`, with `{ push: origin }`
- `conventional`, with `{ push: origin }`
- `conventional-pr`, with `{ push: origin }`
- `keep-a-changelog`, with `{ push: origin }`

[All steps, schemes and sources](../README.md)
