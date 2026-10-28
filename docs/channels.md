# Channels

A channel releases versions that lead up to the next stable one, or number builds of the last, whatever the scheme: `2.0.0-next.1`, `2026.10.0-beta.2`, `1.4.0+nightly.7`. Each channel wraps the scheme's version in a format with a counter:

```yaml
channels:
  next: { branches: [next] }                         # 2.0.0-next.1, 2.0.0-next.2, …
  beta: { branches: ["beta/*"], format: "{version}-beta.{n}" }
  nightly: { type: build }                           # 1.4.0+nightly.1; with channel: nightly
```

A run releases on the channel it's given (the `channel` input or `--channel`), or else on the first whose `branches` match, or else as a stable release.

- A **prerelease** (`type: prerelease`, the default) leads up to the version its changes would bump the last stable release to. Its counter continues across runs, and across branches, so two never share a version. A bigger change moves it on to a bigger version, and starts the counter again.
- A **build** (`type: build`) numbers builds of the last stable release, e.g. nightlies.
- A **stable** release ignores channel releases, so merging `next` into `main` releases `2.0.0` with every change since `1.4.0`.

The default formats are `{version}-{channel}.{n}` and `{version}+{channel}.{n}`; a scheme can have its own, e.g. `{version}rc{n}` for Python's. On a channel, `github/create-release` marks prereleases, and `npm/publish` publishes under the channel's dist-tag. `git/create-tag` only moves `move` tags that name `{channel}`, e.g. a floating `next` tag; the others, like `v{major}`, wait for the stable release. `fs/write-changes`, `keep-a-changelog/write-release` and `change-files/clean` leave the changelog and change files for the stable release, unless they're given `channels: true`.
