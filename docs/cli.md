# CLI, GitLab and other CI

`npx rylease` runs the release in the config file, or `conventional` without one, anywhere. The CLI is its own package, `@rylease/cli`: `rylease` runs the project's, or the latest compatible one through npx, and either way with the project's rylease. In CI, add `@rylease/cli` to `devDependencies`, or the CLI is fetched on each run.

```sh
npx rylease --dry-run                # what would be released, and why
npx rylease --channel next           # release on a channel
npx rylease --release 1.2.0 --notes "…"   # run only the release steps, e.g. in a later job
npx rylease add --component core:feature "Add dark mode"   # a change file
```

`--json` prints the report as JSON, `--summary <file>` appends the Markdown summary, and `--outputs <file>` writes the action's outputs as `RYLEASE_STATUS=released` lines, e.g. for a GitLab dotenv report:

```yaml
release:
  image: node:24
  script:
    - npx rylease --outputs release.env
  artifacts:
    reports:
      dotenv: release.env
```

On GitLab, release with `gitlab/create-release` in place of `github/create-release`; see [Other sources](sources.md#gitlab).

## Testing workflows locally

`rylease test` plays a GitHub Actions workflow on your machine, without Docker, to show what its rylease steps would do in CI:

```sh
npx rylease test                                   # the workflow using rylease, on a push to this branch
npx rylease test release --event workflow_dispatch --ref main --input publish=true
npx rylease test --event pull_request              # does it even run? says why not
```

It checks the workflow's `on` filters for the event, then plays its jobs in order, evaluating `if:`, `env` and `with:` as GitHub does (`${{ }}` and all). Each job gets a fresh checkout at the commit its `actions/checkout` would check out, with your uncommitted changes in it unless you pass `--committed`. Each rylease step runs the action it `uses` (at the commit its ref is now, fetched once), with the `GITHUB_*` environment CI gives it. Its outputs then feed the jobs that `needs` it, across matrices too. `--engine local` runs your rylease instead of the published action.

Every rylease step runs as a **dry run**, whatever the workflow says. Where CI wouldn't do a dry run, the test says so. Steps get no token unless you pass `--token`, or `--gh-token` to use `gh auth token`. Other steps, like `run:` scripts and other actions, aren't run; they're supposed to succeed, and their outputs are mocked:

```sh
npx rylease test --output build.compile.path=dist/app.zip --var CHANNEL=next --set github.actor=me
```

Mocks can also live in `.github/rylease.mocks.yml` (or `--mocks <file>`), with named `scenarios` on top (`--scenario dispatch`):

```yaml
outputs:
  build: { sha: abc123 }               # needs.build.outputs.sha
  upload.compile: { path: app.zip }    # steps.compile.outputs.path, in the upload job
vars: { CHANNEL: next }
scenarios:
  dispatch:
    event: workflow_dispatch
    ref: main
    inputs: { publish: "true" }
```

After the jobs, it lists each job's outputs, warnings (like a shallow `fetch-depth` that rylease would fail on in CI), and every value the workflow read that wasn't set, with mocks for them to paste. `--json` prints all of it as JSON, and it exits with 1 when a job fails. To run every step of a workflow, use [act](https://github.com/nektos/act).
