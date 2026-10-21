import * as presets from "../presets/index.ts";
import { calver, semver } from "../schemes/index.ts";
import * as steps from "../steps/index.ts";
import type { RunChannel } from "./channels.ts";
import { defineRelease, defineStep, when } from "./define.ts";
import { z } from "./options.ts";
import type {
	Change,
	ComponentInfo,
	Dependency,
	Kind,
	ReleaseKind,
	ReleaseResult,
	StepInput,
} from "./types.ts";

describe("step inputs", () => {
	it("include earlier phases and optionally their own", () => {
		expectTypeOf<StepInput<"read-changes">>()
			.toHaveProperty("previousVersion")
			.toEqualTypeOf<string | undefined>();
		expectTypeOf<
			StepInput<"read-changes">["component"]
		>().toEqualTypeOf<ComponentInfo>();
		expectTypeOf<StepInput<"determine-kind">["changes"]>().toEqualTypeOf<
			Change[]
		>();
		expectTypeOf<StepInput<"determine-kind">>()
			.toHaveProperty("kind")
			.toEqualTypeOf<Kind | undefined>();
		expectTypeOf<
			StepInput<"build-notes">["kind"]
		>().toEqualTypeOf<ReleaseKind>();
		expectTypeOf<StepInput<"build-notes">["version"]>().toEqualTypeOf<string>();
		expectTypeOf<StepInput<"build-notes">["tag"]>().toEqualTypeOf<string>();
		expectTypeOf<StepInput<"build-notes">>()
			.toHaveProperty("notes")
			.toEqualTypeOf<string | undefined>();
		expectTypeOf<StepInput<"release">["releases"]>().toEqualTypeOf<
			readonly ReleaseResult[]
		>();
	});

	it("are contextually typed by `type` and `scope`", () => {
		defineStep({
			type: "build-notes",
			name: "header",
			run: ({ version, notes }) => {
				expectTypeOf(version).toEqualTypeOf<string>();
				expectTypeOf(notes).toEqualTypeOf<string | undefined>();
				return { notes: `# ${version}`, reason: "header" };
			},
		});
		defineRelease({
			steps: [
				{
					type: "build-notes",
					name: "inline",
					run: ({ kind }) => {
						expectTypeOf(kind).toEqualTypeOf<"breaking" | "feature" | "fix">();
						return { notes: "", reason: "inline" };
					},
				},
				{
					type: "release",
					name: "inline-all",
					scope: "all",
					run: ({ components }) => {
						expectTypeOf(components[0]?.version).toEqualTypeOf<
							string | undefined
						>();
						return { output: null, reason: "all" };
					},
				},
			],
		});
	});

	it("require a reason and the right output shape", () => {
		defineStep({
			type: "determine-kind",
			name: "no-reason",
			// @ts-expect-error `reason` is required
			run: () => ({ kind: "breaking" }),
		});
		defineStep({
			type: "determine-kind",
			name: "bad-kind",
			// @ts-expect-error not a kind
			run: () => ({ kind: "major", reason: "x" }),
		});
		defineStep({
			type: "determine-kind",
			name: "all-kinds",
			scope: "all",
			run: ({ components }) => ({
				results: Object.fromEntries(
					components.map(({ component }) => [
						component.name,
						{ kind: "fix" as const, reason: "x" },
					]),
				),
				reason: "x",
			}),
		});
		defineStep({
			type: "determine-kind",
			name: "all-without-results",
			scope: "all",
			// @ts-expect-error an `all` step returns results by component
			run: () => ({ kind: "fix", reason: "x" }),
		});
	});
});

describe("prepare, commit and release", () => {
	it("share their input, and prepare steps may defer the release", () => {
		defineStep({
			type: "prepare",
			name: "propose",
			run: ({ dependencies, env }) => {
				expectTypeOf(dependencies).toEqualTypeOf<readonly Dependency[]>();
				expectTypeOf(env.channel).toEqualTypeOf<RunChannel | undefined>();
				return { output: null, reason: "x", defer: "later" };
			},
		});
		defineStep({
			type: "commit",
			name: "commit",
			scope: "all",
			run: ({ components }) => ({
				output: components.length,
				reason: "x",
				defer: "later",
			}),
		});
	});
});

describe("facts", () => {
	it("narrow what a step needs", () => {
		defineStep({
			type: "determine-kind",
			name: "labels",
			needs: ["changes.labels", "previousVersion"],
			run: ({ changes, previousVersion }) => {
				expectTypeOf(changes[0]?.labels).toEqualTypeOf<string[] | undefined>();
				expectTypeOf(changes[0]?.title).toEqualTypeOf<string | undefined>();
				expectTypeOf(previousVersion).toEqualTypeOf<string>();
				return { kind: "fix", reason: "x" };
			},
		});
		defineStep({
			type: "build-notes",
			name: "titles",
			scope: "all",
			needs: ["changes.title"],
			run: ({ components }) => {
				expectTypeOf(components[0]?.changes[0]?.title).toEqualTypeOf<
					string | undefined
				>();
				return { results: {}, reason: "x" };
			},
		});
	});

	it("make a step return what it provides", () => {
		defineStep({
			type: "read-changes",
			name: "labeled",
			provides: ["changes.labels"],
			run: () => ({ changes: [{ reason: "x", labels: [] }], reason: "x" }),
		});
		defineStep({
			type: "read-changes",
			name: "unlabeled",
			provides: ["changes.labels"],
			// @ts-expect-error every change must have labels
			run: () => ({ changes: [{ reason: "x" }], reason: "x" }),
		});
		defineStep({
			type: "release",
			name: "unknown",
			// @ts-expect-error not a fact
			needs: ["changes.jira"],
			run: () => ({ output: null, reason: "x" }),
		});
	});
});

describe("context", () => {
	it("flows from defineRelease to every step", () => {
		defineRelease<{ count: number }>({
			context: { count: 0 },
			steps: [
				...presets.conventional(),
				{
					type: "release",
					name: "count",
					run: ({ context }) => {
						expectTypeOf(context).toEqualTypeOf<{ count: number }>();
						context.count++;
						return { output: context.count, reason: "counted" };
					},
				},
			],
		});
	});

	it("is required only when the context type needs it", () => {
		defineRelease({ steps: presets.conventional() });
		// @ts-expect-error missing context
		defineRelease<{ count: number }>({ steps: presets.conventional() });
	});
});

describe("releases", () => {
	it("take a scheme, tag, histories and components", () => {
		defineRelease({
			steps: presets.conventional(),
			scheme: calver({ format: "YY.MINOR.MICRO" }),
			tag: "{name}-{version}",
			history: [],
			components: [
				{ name: "core", path: "packages/core" },
				{
					name: "cli",
					path: "packages/cli",
					dependsOn: ["core"],
					scheme: semver(),
				},
			],
		});
		// @ts-expect-error a scheme, not a factory
		defineRelease({ steps: [], scheme: semver });
	});
});

describe("step options", () => {
	const step = defineStep({
		type: "release",
		name: "typed",
		options: {
			target: z.string(),
			retries: z.number().default(3),
			label: z.string().optional(),
		},
		run: ({ options }) => {
			expectTypeOf(options.target).toEqualTypeOf<string>();
			expectTypeOf(options.retries).toEqualTypeOf<number>();
			expectTypeOf(options.label).toEqualTypeOf<string | undefined>();
			return { output: null, reason: "ok" };
		},
	});

	it("type the factory's argument, required only when an option is", () => {
		expectTypeOf(step.name).toEqualTypeOf<"typed">();
		step({ target: "x" });
		step({ target: "x", retries: 1, label: "y" });
		// @ts-expect-error `target` is required
		step({});
		// @ts-expect-error the argument is required
		step();
		// @ts-expect-error wrong type
		step({ target: 1 });
		steps.conventionalDetermineKind({ types: { docs: "none" } });
		// @ts-expect-error not a kind
		steps.conventionalDetermineKind({ types: { docs: "minor" } });
		calver({ format: "YY.MINOR.MICRO" });
		// @ts-expect-error wrong type
		semver({ shiftPreMajor: "no" });
	});

	it("type preset options by step name", () => {
		presets.conventional({
			"github/create-release": false,
			"conventional/determine-kind": {
				types: { docs: "none" },
				fallback: "none",
			},
		});
		// @ts-expect-error not a step of the preset
		presets.conventional({ nope: false });
		// @ts-expect-error wrong option type
		presets.conventional({ "git/create-tag": { push: 1 } });
	});
});

describe("conditions", () => {
	it("take what the step receives", () => {
		defineRelease({
			steps: [
				...presets.conventional(),
				when(
					steps.npmPublish(),
					({ env, version }) => !env.dryRun && version !== "",
				),
				when(steps.gitCommit(), ({ components }) => components.length > 0),
			],
		});
	});
});
