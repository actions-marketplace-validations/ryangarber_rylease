# Configuration

## Steps

`steps` is a list shaped like a workflow's. Each entry `uses` a step or preset, gives it options `with`, and may run only `if` an expression holds.

```yaml
  - uses: ryangarber/rylease@v3
    with:
      steps: |
        - uses: conventional
          with:
            github/create-release: { draft: true }
            conventional/determine-kind:
              types: { docs: none, chore: none, "chore(deps)": fix }
        - uses: ./.github/release/announce.ts
          if: "!dryRun && kind != 'fix'"
          with:
            channel: "#releases"
```

- **`uses`** names a bundled step or preset, a path to a file (`./release/announce.ts`, its default export), or an installed package (`some-package`, or `some-package#namedExport`). `.ts` files run as they are; they can `import { defineStep, z } from "rylease"` without installing it. See [TypeScript](typescript.md) for writing your own.
- **`with`** holds the options. A preset takes options for each of its steps by name, and `false` leaves a step out, for instance to replace it with your own, or to list it again with an `if`. Listing a step that a preset already has is an error, so nothing runs twice by accident.
- **`if`** runs the step only when an expression holds; see [Conditions](#conditions). On a preset, it applies to each of its steps.
- **Options** are checked before anything runs. A typo fails the job with its exact location, e.g. `steps[0].with.git/create-tag: Unrecognized key: "pushh"`.

Each step's options are in the [reference](reference/README.md).

## Config file

The same keys can live in a config file instead: `rylease.yml`, `.github/rylease.yml`, or `rylease.config.ts` exporting a release made with `defineRelease`. The action, the [CLI](cli.md) and other CI all read it, and the action's inputs override its keys.

```yaml
# rylease.yml
steps:
  - uses: conventional
channels:
  next: { branches: [next] }
```

## Action inputs

| Input | Default | |
|---|---|---|
| `steps` | `- uses: conventional` | The steps, as above. |
| `scheme` | the preset's | How versions look and are bumped: `semver`, `calver`, or with options, `{ uses: calver, with: { format: YY.MINOR.MICRO } }`. Needed when no preset provides one. See [Schemes](schemes.md). |
| `tag` | `v{version}` | Each release's tag. With several components, `{name}@{version}`. |
| `history` | the preset's | Where the previous release is found: `git/tags`, or a list tried in turn, e.g. `[git/tags, { uses: fs/version-file, with: { format: npm } }]`. Needed when no preset provides one. |
| `components` | the whole project | What's versioned, for monorepos: `npm/workspaces`, or a list. See [Monorepos](monorepos.md). |
| `channels` | none | Prerelease and build channels, e.g. `{ next: { branches: [next] } }`. See [Channels](channels.md). |
| `channel` | | The channel to release on, e.g. `nightly`; by default the first whose branches match. |
| `config` | the first that exists | A config file with any of the keys above. |
| `dry-run` | `false` | Runs every step without side effects; each reports what it would do. |
| `version` | | A version that's already been worked out, e.g. by an earlier job: only the `release` steps run, for it. See [Uploading builds](uploading-builds.md). |
| `notes` | | The release notes, along with `version`. |
| `component` | | The component `version` is for, when there are several. |
| `working-directory` | `.` | The project to release. |
| `summary` | `true` | Writes the release, a row per step and the notes to the job's summary page. |
| `token` | `${{ github.token }}` | Used when `GITHUB_TOKEN` isn't set. |

## Action outputs

`status` (`released`, `pending` when a [release pull request](release-pull-requests.md) is proposed, `unchanged` or `failed`), `released` (`true`/`false`), `previous-version`, `version`, `kind` (`breaking`, `feature`, `fix` or `none`), `notes`, `channel` and `prerelease`. There's also `components`, each component's values as JSON, and `released-components`, a JSON list of the names of those released, e.g. for a matrix.

## Conditions

`if` is evaluated just before the step would run, so it can depend on what earlier steps did:

```yaml
- uses: npm/publish
  if: "!dryRun && !prerelease"
- uses: ./release/announce.ts
  if: kind == 'breaking' || contains(notes, 'security')
- uses: ./release/link.ts
  if: steps['github/create-release'].output.url != null
```

| Name | |
|---|---|
| `dryRun`, `branch`, `cwd` | The run's environment. |
| `channel`, `prerelease` | The channel released on, or `null`, and whether it's a prerelease channel. |
| `previousVersion`, `previousRef`, `previousTag`, `changes`, `kind`, `version`, `tag`, `notes`, `dependencies` | The release so far; a value is `null` until its phase has run. |
| `component` | The component the step runs for: `component.name` and `component.path`. |
| `components` | For steps that run once for all components: each one's values. |
| `steps['<name>']` | Each step that ran before: its `phase`, `status` (`ok` or `skipped`), `reason` and `output`. Names with a `/` need brackets, e.g. `steps['git/commit'].output`; others can also be read as `steps.announce`. |

Expressions are written like GitHub's: `'strings'` (`''` for a quote), numbers, `true`, `false` and `null`; `.name` and `['name']`; `!`, `==`, `!=`, `<`, `<=`, `>`, `>=`, `&&`, `||` and parentheses; and `contains(text or list, value)`, `startsWith(text, prefix)` and `endsWith(text, suffix)`. Comparisons are exact, and case-sensitive. An `if` starting with `!` needs quotes in YAML.

GitHub fills in `${{ ... }}` in `steps` before rylease reads it, so `if: ${{ github.event_name == 'workflow_dispatch' }}` works too and becomes `if: true` or `if: false`. If conditions skip every step of a phase, the next phase fails, since it has nothing to go on.

In TypeScript, a condition is a function of what the step receives: `when(steps.npmPublish(), ({ env }) => !env.dryRun)`.
