# `fs/version-file`

History: set it as the release's `history`.

The version in the project's version file, in any format `fs/write-version` writes, released at the commit that set it.

## Options

| Option | Type | Default | |
|---|---|---|---|
| `format` | `plain \| npm \| cargo \| python \| dart \| ruby \| dotnet \| helm \| gradle \| maven \| pattern` | `plain` | As for `fs/write-version`. |
| `path` | `string` |  | Relative to the component's directory; defaults to the format's file. A glob must match one file. |
| `pattern` | `string` |  | With the `pattern` format, where the version is. |

[All steps, schemes and sources](../README.md)
