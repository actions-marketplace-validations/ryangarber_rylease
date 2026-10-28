# `gitlab/create-release`

Step, in the `release` phase.

Creates a GitLab release of the tag with the notes, unless it already has one; the tag is created at HEAD if it doesn't exist.

## Options

| Option | Type | Default | |
|---|---|---|---|
| `title` | `string` | `{tag}` | `{tag}`, `{version}`, `{name}` and the scheme's placeholders are filled in. |
| `project` | `string` |  | The project's ID or path, e.g. `group/project`; defaults to `CI_PROJECT_ID`. |
| `token` | `string` |  | Defaults to `GITLAB_TOKEN`, then the job's `CI_JOB_TOKEN`. |

[All steps, schemes and sources](../README.md)
