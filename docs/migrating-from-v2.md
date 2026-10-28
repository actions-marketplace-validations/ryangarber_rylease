# Migrating from v2

| v2 | v3 |
|---|---|
| `git/read-tag` | `history: git/tags`, which the presets give: the previous release is the nearest tag on HEAD, so a `1.x` branch finds its own. Set its template with the release's `tag`. |
| `npm/read-version`, `fs/read-version` | `history: [git/tags, { uses: fs/version-file, with: { format: npm } }]` (or `format: plain` for a `VERSION` file). |
| `npm/write-version` | `fs/write-version` with `format: npm`. |
| `version/bump-semver` | `scheme: semver`, which `conventional` and `conventional-pr` give, with the same `shiftPreMajor`. |
| `version/calver` | `scheme: { uses: calver, with: { format: … } }`. |
| Kinds `major`, `minor`, `patch` | `breaking`, `feature`, `fix`, in options (`types: { docs: none, "chore(deps)": fix }`), conditions and outputs. |
| `tag` options of `git/create-tag`, `github/create-release`, `gitlab/create-release`, `github/upload-release-assets`, `keep-a-changelog/write-release` | The release's `tag`, set once. Templates get `{tag}`; `git/commit`'s message is `chore(release): {tags}`. |
| Listing steps that write files before a preset | Not needed: `fs/write-*` steps are `write` steps and `git/commit` a `stage` step, so they run in order wherever they're listed. Custom steps that change files should be `write` steps. |
| `working-directory` per package | `components: npm/workspaces`, in one run. |
| Steps of type `read-version` or `bump-version` | A history (`defineHistory`) or scheme (`defineScheme`). |
