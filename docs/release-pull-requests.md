# Release pull requests

Instead of releasing on every push, rylease can propose the release in a pull request, kept up to date as changes land, and release it when it's merged:

```yaml
  - uses: ryangarber/rylease@v3
    with:
      steps: |
        - uses: conventional-pr
        - uses: fs/write-version
          with: { format: npm }
```

On a push, [`github/open-release-pr`](reference/github/open-release-pr.md) commits what the `write` steps changed to `rylease/main`, and opens a pull request for it, or updates the open one. Its body holds each release's notes. The run is `pending`, and nothing is tagged. When the pull request is merged, the next run finds it through `conventional-pr`'s history, [`github/release-pr`](reference/github/release-pr.md): only the `release` steps run, for the versions and notes it proposed. The job needs `pull-requests: write` as well as `contents: write`.
