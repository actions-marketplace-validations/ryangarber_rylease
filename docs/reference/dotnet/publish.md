# `dotnet/publish`

Step, in the `release` phase.

Pushes the component's packed `.nupkg` packages of the release's version to nuget.org, or another source, with `dotnet nuget push`.

## Options

| Option | Type | Default | |
|---|---|---|---|
| `files` | `string \| string[]` | `**/*.nupkg` | Globs of the packages, relative to the component's directory; those of other versions, and symbol packages, are left out. |
| `source` | `string` | `https://api.nuget.org/v3/index.json` |  |
| `token` | `string` |  | The API key; defaults to `NUGET_API_KEY`. Without one, the source's credentials in NuGet's config are used. |

[All steps, schemes and sources](../README.md)
