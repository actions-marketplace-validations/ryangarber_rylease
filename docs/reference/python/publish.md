# `python/publish`

Step, in the `release` phase.

Uploads the component's built wheels and sdists of the release's version to PyPI, or another index, with `uv publish` or `twine upload`.

## Options

| Option | Type | Default | |
|---|---|---|---|
| `files` | `string \| string[]` | `dist/*` | Globs of the distributions, relative to the component's directory; those of other versions are left out. |
| `client` | `uv \| twine` | `uv` |  |
| `registry` | `string` | `https://upload.pypi.org/legacy/` | The index's upload URL. |
| `token` | `string` |  | Defaults to `PYPI_TOKEN`; without one, the client's own auth is used, e.g. `uv`'s trusted publishing. |

[All steps, schemes and sources](../README.md)
