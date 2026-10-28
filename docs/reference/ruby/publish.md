# `ruby/publish`

Step, in the `release` phase.

Packs the component's gem with `gem build` and pushes it to RubyGems, or another host, with `gem push`.

## Options

| Option | Type | Default | |
|---|---|---|---|
| `gemspec` | `string` |  | Relative to the component's directory; defaults to its one `*.gemspec`. |
| `host` | `string` | `https://rubygems.org` |  |
| `token` | `string` |  | Defaults to `GEM_HOST_API_KEY`, which `gem` reads itself; without one, its own credentials are used. |

[All steps, schemes and sources](../README.md)
