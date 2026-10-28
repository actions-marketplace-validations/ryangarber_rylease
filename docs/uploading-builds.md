# Uploading builds

Jobs that build after the release, say one per platform, can each upload their files to it. Pass the version (and notes) the release job worked out, and only the `release` steps run. Here the `release` job passes on rylease's `released`, `version` and `notes` outputs, and whether it was a dry run, as its own outputs:

```yaml
  build:
    needs: release
    if: needs.release.outputs.released == 'true'
    strategy:
      matrix:
        os: [macos-latest, ubuntu-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v7
        with:
          ref: v${{ needs.release.outputs.version }}
      - run: npm ci && npm run build
      - uses: ryangarber/rylease@v3
        with:
          version: ${{ needs.release.outputs.version }}
          notes: ${{ needs.release.outputs.notes }}
          dry-run: ${{ needs.release.outputs.dry-run }}
          scheme: semver # no preset here to provide them
          history: git/tags
          steps: |
            - uses: github/upload-release-assets
              with:
                files: ["dist/app-*"]
                dryRunArtifact: true
```

[`github/upload-release-assets`](reference/github/upload-release-assets.md) uploads to the release that `github/create-release` created, or creates it if no job has yet. When several jobs race to, the losers wait for the winner's release and use it. Failed requests and uploads are retried, and an upload that failed halfway is cleared first. With `dryRunArtifact`, a dry run keeps the files as a workflow artifact instead, so a dry run of the whole pipeline leaves every build to download. [`github/upload-artifact`](reference/github/upload-artifact.md) does the same for any files, in a dry run or not.
