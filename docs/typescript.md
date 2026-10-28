# TypeScript

The same release as a workflow's, as a script:

```ts
// release.ts
import { defineRelease, presets, schemes, sources } from "rylease";

await defineRelease({
	scheme: schemes.semver({ initial: "1.0.0" }),
	history: [sources.gitTags(), sources.fsVersionFile({ format: "npm" })],
	channels: { next: { branches: ["next"] } },
	steps: [
		...presets.conventional({
			"github/create-release": { draft: true },
			"conventional/determine-kind": { types: { docs: "none", chore: "none" } },
		}),
		announce({ channel: "#releases" }),
	],
})
	.run({ dryRun: process.argv.includes("--dry-run") })
	.catch(() => {
		process.exitCode = 1; // the failure has already been printed
	});
```

Export the release as the default export of `rylease.config.ts` instead, and the action and the CLI run it. `markdownSummary(report)` renders a report as the Markdown the action writes to the job summary. Each bundled step is also exported on its own (`steps.gitCreateTag`, …).

## How steps run

| Type | Receives (plus `component`, `previousVersion?`, `previousRef?`, `previousTag?`, `env`, `context`, `history`) | Returns |
|---|---|---|
| `read-changes` | `changes?` | `{ changes: { title?, description?, reason, link?, labels? }[], reason }` |
| `determine-kind` | … `changes`, `kind?` | `{ kind: "breaking" \| "feature" \| "fix" \| "none", version?, reason }` |
| `determine-notes` | … `kind` (never `"none"`), `version`, `tag`, `placeholders`, `dependencies`, `notes?` | `{ notes, reason }` |
| `write`, `stage` | … `notes`, `releases` (results of earlier `write`, `stage` and `release` steps) | `{ output, files?, defer?, reason }` |
| `release` | … `notes`, `releases` | `{ output, files?, reason }` |

- **Order.** Steps are sorted by phase. Steps of the same phase keep the order you gave them.
- **Chaining.** When several steps share a phase, each later one receives the current value as an optional input (e.g. `notes?`). Whatever it returns replaces that value. `write`, `stage` and `release` outputs accumulate instead.
- **One source of truth.** A step takes what it needs from earlier phases and never works it out again. `previousRef` is the commit of the previous release, and changes are collected from there. `tag` is the release's tag, and `placeholders` fill templates. `files` lists what a `write` step changed, and `git/commit` commits exactly those.
- **Scope.** A step runs once per component (`scope: "each"`, the default) or once for all of them (`scope: "all"`). Then it receives `components`, each with what it would receive on its own, and returns `results` by component name, or from `write` on, one result for all.
- **Facts.** A step declares the facts it `needs` and `provides`, e.g. `changes.labels`: every change has labels. Before anything runs, each need must be met by an earlier step, or for `version.semver`, by the scheme. Provided facts are checked on the step's output. Facts about changes last only until another step replaces the changes. `needs` can also be a function of the step's options, e.g. by format.
- **Deferring.** A `write` or `stage` step that returns `defer` leaves the release to later: the `release` steps are skipped with that reason, and the run is `pending`.
- **Nothing to release.** A component whose final kind is `"none"` drops out; if none are left, the remaining steps are skipped.
- **Dry run.** Steps get `env.dryRun`. Steps with side effects must do nothing and explain what they *would* have done. The one exception is `dryRunArtifact`, which keeps files as an artifact of the workflow run, which only that run sees.
- **Audit.** `run()` resolves to a report with a record (phase, name, component, status, duration, reason, output) for every step, and for the previous and next versions. On failure it rejects with a `ReleaseError` whose `.report` holds the same records.

## Custom steps

`defineStep` declares a step and its options, as a [zod](https://zod.dev) shape. The result is a factory: call it with options to get a step. Options are typed from the shape, and validated on every call, whether they come from TypeScript or from a workflow file. Use `.default()` for optional options, and `.describe()` to document them.

```ts
// .github/release/announce.ts
import { defineStep, z } from "rylease";

export default defineStep({
	phase: "release",
	name: "announce",
	description: "Posts the release to Slack.",
	options: {
		channel: z.string().describe("Where to post."),
		mention: z.boolean().default(false),
	},
	run: async ({ version, env, options }) => {
		if (env.dryRun) return { output: null, reason: `would announce in ${options.channel}` };
		await postToSlack(options.channel, `Released ${version}`);
		return { output: null, reason: `announced ${version} in ${options.channel}` };
	},
});
```

`needs` types the step's input accordingly, and `provides` its output:

```ts
export const byJira = defineStep({
	phase: "determine-kind",
	name: "jira/determine-kind",
	needs: ["changes.labels"],
	run: ({ changes }) => ({
		// `labels` is `string[]` here, never undefined.
		kind: changes.some((change) => change.labels.includes("epic")) ? "feature" : "fix",
		reason: "by Jira labels",
	}),
});
```

Add facts of your own by declaration merging: `declare module "rylease" { interface Facts { "changes.jira": true } }`.

Steps that run git can use `git(env.cwd, ...args)`, which resolves with its trimmed output and fails with git's own error, or `tryGit`, which resolves with `undefined` instead of failing.

`definePreset({ name, steps })` bundles factories, like `presets.conventional`, and takes options per step by name. It can also give the `scheme` and `history` of releases made with it, as factories, e.g. `history: sources.gitTags`; a release's own wins, and two presets that both give one are an error. `defineHistory` and `defineComponents` define where previous releases and components come from, the same way. For schemes, see [Schemes](schemes.md#your-own).

Steps given inline to `defineRelease` are plain `{ phase, name, run }` objects, typed from their `phase` and `scope`.

## Context

`context` holds whatever state you want to share between inline steps, and its type is yours. It is the only place for arbitrary state, and the bundled steps never touch it.

```ts
defineRelease<{ slackTs?: string }>({
	context: {},
	steps: [
		...presets.conventional(),
		{
			phase: "release",
			name: "announce",
			run: async ({ version, context, env }) => {
				if (env.dryRun) return { output: null, reason: "would announce" };
				context.slackTs = await postToSlack(`Released ${version}`);
				return { output: context.slackTs, reason: "posted to #releases" };
			},
		},
	],
});
```
