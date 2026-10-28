# Ecosystems

The presets work from git tags alone, in any project. To keep the version in a project's own files, publish packages, or run anything else, add steps.

## Node

To also keep the version in `package.json` and a `CHANGELOG.md`, add the steps that write them, and `git/commit` to commit what they change. Steps run by phase, so the order you list them in doesn't matter:

```yaml
  - uses: ryangarber/rylease@v3
    with:
      history: "[git/tags, { uses: fs/version-file, with: { format: npm } }]"
      steps: |
        - uses: conventional
        - uses: fs/write-version
          with: { format: npm }
        - uses: fs/write-changes
        - uses: git/commit
```

`history` finds the previous release from its tag. A project that's never been tagged falls back to the version in `package.json`, released at the commit that set it. If there's neither, every commit counts and the release is the scheme's first (`0.1.0` for semver, set with `initial`).

`git/commit` and `git/create-tag` each have a `push` option, off by default. The presets set it on `git/create-tag` alone, which pushes the branch along with the tags in one atomic push, so the release commit and its tag land together or not at all.

### Publishing to npm

Add [`npm/publish`](reference/npm/publish.md) too. It publishes with `pnpm` or `npm`, whichever the project uses, so lifecycle scripts like `prepublishOnly` run as usual. Install dependencies first, and set up pnpm if the project uses it.

```yaml
permissions:
  contents: write
  id-token: write # for trusted publishing, or provenance
steps:
  - uses: actions/checkout@v7
    with:
      fetch-depth: 0
  - uses: pnpm/setup@v3 # installs dependencies too
  - uses: ryangarber/rylease@v3
    with:
      steps: |
        - uses: conventional
        - uses: fs/write-version
          with: { format: npm }
        - uses: git/commit
        - uses: npm/publish
    env:
      NPM_TOKEN: ${{ secrets.NPM_TOKEN }} # not needed with trusted publishing
```

It publishes the version that `fs/write-version` wrote, after the release is committed, tagged and pushed, and refuses to publish any other. On a channel, it publishes under the channel's dist-tag, e.g. `next`. npm only takes semantic versions, so both steps need a scheme that makes them; with `calver` and a zero-padded format like `YYYY.0M.MICRO`, the release fails before anything runs.

## Dart and Flutter

The `dart` format keeps the version in `pubspec.yaml`, and [`dart/publish`](reference/dart/publish.md) publishes the package to pub.dev, or to the server in its `publish_to`, with `flutter pub publish` for packages that depend on Flutter and `dart pub publish` otherwise:

```yaml
- uses: conventional
- uses: fs/write-version
  with: { format: dart }
- uses: fs/write-changes
- uses: git/commit
- uses: dart/publish
```

A build number, like a Flutter app's `version: 1.4.0+27`, isn't part of the release: the release is `1.4.0`, tagged `v1.4.0`, and `fs/write-version` increments the build number with each one, to `1.5.0+28`, since app stores need every upload's to be higher. An app has `publish_to: none`, so leave out `dart/publish`, and build and upload it in later jobs, checked out at the release's tag, so `flutter build` takes the version and build number from `pubspec.yaml`.

`dart/publish` publishes what `fs/write-version` wrote, after the release is committed, tagged and pushed, and refuses any other version. pub.dev only accepts GitHub's OIDC tokens from a workflow that a tag push started, and a tag rylease pushes with the job's `GITHUB_TOKEN` doesn't start one. So either push tags with a token that does, e.g. a GitHub App's, and publish from the workflow they start (with `version` and only `release` steps, as in [Uploading builds](uploading-builds.md)), or publish with a Google Cloud service account's token in `PUB_TOKEN`, which `dart/publish` adds for the server with `pub token add`:

```yaml
- uses: dart-lang/setup-dart@v1
- uses: google-github-actions/auth@v2
  with: { workload_identity_provider: ..., service_account: pub-dev@my-project.iam.gserviceaccount.com }
- run: echo "PUB_TOKEN=$(gcloud auth print-identity-token --audiences=https://pub.dev)" >> "$GITHUB_ENV"
- uses: ryangarber/rylease@v3
  # …
```

In a pub workspace, or a Melos one, `components: dart/workspaces` makes each package a component, as `npm/workspaces` does; see [Monorepos](monorepos.md). Packages with `publish_to: none` are left out unless it's given `private: true`, and the root is a component too when it has a `version`, as a Flutter app with its packages beside it does.

## Version files

[`fs/write-version`](reference/fs/write-version.md) writes the version wherever a project keeps it, keeping the rest of the file as it was, and [`fs/version-file`](reference/fs/version-file.md) reads it back as a history:

| `format` | File | |
|---|---|---|
| `plain` | `VERSION` | The whole file. |
| `npm` | `package.json` | `version`, and dependencies on other released components. |
| `cargo` | `Cargo.toml` | `version` in `[package]` or `[workspace.package]`, and `version`s of dependencies on other released crates. |
| `python` | `pyproject.toml` | `version` in `[project]` or `[tool.poetry]`. |
| `dart` | `pubspec.yaml` | `version`, incrementing a build number like `+27`, and dependencies on other released packages. |
| `ruby` | `lib/**/version.rb` | A gem's `VERSION = "…"`. |
| `dotnet` | `*.csproj` | A `<Version>` property; set `path` for one in `Directory.Build.props`. |
| `helm` | `Chart.yaml` | The chart's `version`. |
| `gradle` | `gradle.properties` | `version=`. |
| `maven` | `pom.xml` | The project's own `<version>`, not its parent's or its dependencies'. |
| `pattern` | any | Wherever a template matches, e.g. `pattern: '__version__ = "{version}"'`, or `appVersion: "{version}"` in `Chart.yaml`. |

## Publishing

Each ecosystem has a step that publishes the release, after it's committed, tagged and pushed. Building, and testing, stay with your workflow: the steps that need built packages take them from where the build put them, and only publish those of the version being released. Build them once the new version is written: with `exec/command` in `write`, listed after `fs/write-version`, e.g. `uv build` or `dotnet pack -c Release`, or in a later job checked out at the release's tag, as in [Uploading builds](uploading-builds.md). A dry run, which writes nothing, only says what it would publish.

| Step | Publishes | Token |
|---|---|---|
| [`npm/publish`](reference/npm/publish.md) | The package, with `npm` or `pnpm publish`. | `NPM_TOKEN`, or trusted publishing. |
| [`dart/publish`](reference/dart/publish.md) | The package, with `dart` or `flutter pub publish`. | `PUB_TOKEN`; see [Dart and Flutter](#dart-and-flutter). |
| [`cargo/publish`](reference/cargo/publish.md) | The crate, with `cargo publish`, which builds it to check it. | `CARGO_REGISTRY_TOKEN`, e.g. from `rust-lang/crates-io-auth-action`. |
| [`python/publish`](reference/python/publish.md) | The built wheels and sdists in `dist/`, with `uv publish` or `twine upload`. | `PYPI_TOKEN`, or uv's trusted publishing. |
| [`ruby/publish`](reference/ruby/publish.md) | The gem, packed with `gem build`, with `gem push`. | `GEM_HOST_API_KEY`. |
| [`dotnet/publish`](reference/dotnet/publish.md) | The packed `.nupkg` packages, with `dotnet nuget push`. | `NUGET_API_KEY`, e.g. from `NuGet/login`. |

Go modules need nothing more than their tag.

## Anything else

[`exec/command`](reference/exec/command.md) runs any command, with `{placeholders}` filled in, in the `phase` it's given: in `write`, e.g. to update a lockfile, and in `release` to ship it. In a dry run it only says what it'd run, unless it's given a `dryRun` command to run instead.

```yaml
- uses: conventional
- uses: fs/write-version
  with: { format: cargo }
- uses: exec/command
  with: { phase: write, command: cargo update --workspace, files: [Cargo.lock] }
- uses: git/commit
- uses: cargo/publish
- uses: exec/command
  with: { phase: release, command: "docker buildx build --push -t ghcr.io/me/app:{version} ." }
```

A gem's `Gemfile.lock` lists its own version, so update it in `write` too, e.g. with `exec/command` running `bundle lock` with `files: [Gemfile.lock]`.
