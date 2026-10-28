# Schemes

A release's kind says how much changed, whatever the scheme: `breaking`, `feature`, `fix`, or `none` for nothing to release. The scheme decides what each kind bumps. It's also the one place that recognizes and orders versions, so finding the previous release, bumping and tagging always agree.

[`semver`](reference/semver.md) bumps `MAJOR.minor.patch`; `conventional` and `conventional-pr` use it, since conventional commits are defined by it. Before 1.0.0 it shifts bumps down a level (`0.MAJOR.minorOrPatch`) unless `shiftPreMajor` is off.

## Calendar versions

Calendar versions, from conventional commits:

```yaml
- uses: ryangarber/rylease@v3
  with:
    scheme: "{ uses: calver, with: { format: YYYY.MM.MICRO } }" # 2026.10.0, 2026.10.1, … 2026.11.0
    steps: |
      - uses: conventional
        with:
          git/create-tag: { move: ["v{YYYY}.{MM}"] } # v2026.10, the month's latest
```

[`calver`](reference/calver.md) takes the date from the clock, in UTC unless you set `timezone`. Its counters number the releases of a period, and the kind picks which: in `YY.MINOR.MICRO`, a fix bumps `MICRO` and a feature `MINOR`. In a new period they all start again from 0. A format without a counter, like `YYYY.0M.0D`, can release once per period. Its tokens are placeholders in templates, e.g. `{YYYY}`; every scheme also fills `{major}`, `{minor}` and `{patch}` with a version's first three numbers.

## Switching schemes

Switching schemes is safe. The previous release is still found, so changes start from it, but a version from another scheme isn't bumped: the next release is the new scheme's first.

## Your own

A scheme of your own is an object with `matches`, `compare`, `bump` and optionally `fields`, `traits` and `formats` (for [channels](channels.md)). Define it with `defineScheme`, like a step, to use it from a workflow too, as `scheme: ./.github/release/four-part.ts`:

```ts
// .github/release/four-part.ts: MAJOR.minor.patch.build, the build always counting up
import { defineScheme } from "rylease";

const numbers = (version: string) => version.split(".").map(Number);

export default defineScheme({
	name: "four-part",
	create: () => ({
		name: "four-part",
		matches: (version) => /^\d+\.\d+\.\d+\.\d+$/.test(version),
		compare: (a, b) => {
			const [x, y] = [numbers(a), numbers(b)];
			return x.reduce((order, n, i) => order || n - (y[i] ?? 0), 0);
		},
		bump: ({ previous = "0.0.0.0", kind }) => {
			const [major = 0, minor = 0, patch = 0, build = 0] = numbers(previous);
			const next = {
				breaking: [major + 1, 0, 0],
				feature: [major, minor + 1, 0],
				fix: [major, minor, patch + 1],
			}[kind];
			return { version: [...next, build + 1].join("."), reason: `bumps ${kind}` };
		},
	}),
});
```

`determine-kind` steps can also set the version outright, e.g. from a `Release-As:` footer, by returning `version` with the kind; the scheme still checks it.
