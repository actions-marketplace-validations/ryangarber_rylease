# `github/upload-release-assets`

Step, in the `release` phase.

Uploads files to the GitHub release, creating it (with the notes) if no other job has yet.

## Options

| Option | Type | Default | |
|---|---|---|---|
| `files` | `string[]` | required | Paths or globs, relative to the component's directory unless absolute; each must match. |
| `clobber` | `boolean` | `true` | Replace assets of the same name. |
| `dryRunArtifact` | `boolean` | `false` | In dry runs, keep the files as a workflow artifact instead; only in the GitHub Action. |
| `artifactName` | `string` |  | Unique in the run; `{version}`, `{tag}` and the other placeholders are filled in. Defaults to the asset's name, or for several, a name made from theirs. |
| `title` | `string` | `{tag}` | `{tag}`, `{version}`, `{name}` and the scheme's placeholders are filled in. |
| `draft` | `boolean` | `false` |  |
| `prerelease` | `boolean \| auto` | `auto` | `auto` marks releases on a prerelease channel. |
| `repo` | `string` |  | `owner/repo`; defaults to `GITHUB_REPOSITORY` or the `origin` remote. |
| `token` | `string` |  | Defaults to `GITHUB_TOKEN` or `GH_TOKEN`. |

[All steps, schemes and sources](../README.md)
