import { describe, expectTypeOf, it } from "vitest";
import { defineRelease, defineStep } from "./define.ts";
import { steps } from "./index.ts";
import { z } from "./options.ts";
import type { Change, ReleaseKind, ReleaseResult, StepInput } from "./types.ts";

describe("step inputs", () => {
	it("include earlier phases and optionally their own", () => {
		expectTypeOf<StepInput<"previous-version">>()
			.toHaveProperty("previousVersion")
			.toEqualTypeOf<string | undefined>();
		expectTypeOf<StepInput<"release-kind">["changes"]>().toEqualTypeOf<
			Change[]
		>();
		expectTypeOf<
			StepInput<"release-version">["kind"]
		>().toEqualTypeOf<ReleaseKind>();
		expectTypeOf<
			StepInput<"release-notes">["version"]
		>().toEqualTypeOf<string>();
		expectTypeOf<StepInput<"release-notes">>()
			.toHaveProperty("notes")
			.toEqualTypeOf<string | undefined>();
		expectTypeOf<StepInput<"release">["releases"]>().toEqualTypeOf<
			readonly ReleaseResult[]
		>();
	});

	it("are contextually typed by `type`", () => {
		defineStep({
			type: "release-notes",
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
					type: "release-version",
					name: "inline",
					run: ({ kind }) => {
						expectTypeOf(kind).toEqualTypeOf<"major" | "minor" | "patch">();
						return { version: "1.0.0", reason: "inline" };
					},
				},
			],
		});
	});

	it("require a reason and the right output shape", () => {
		defineStep({
			type: "release-kind",
			name: "no-reason",
			// @ts-expect-error `reason` is required
			run: () => ({ kind: "major" }),
		});
		defineStep({
			type: "release-kind",
			name: "bad-kind",
			// @ts-expect-error not a kind
			run: () => ({ kind: "huge", reason: "x" }),
		});
	});
});

describe("context", () => {
	it("flows from defineRelease to every step", () => {
		defineRelease<{ count: number }>({
			context: { count: 0 },
			steps: [
				...steps.conventional(),
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
		defineRelease({ steps: steps.conventional() });
		// @ts-expect-error missing context
		defineRelease<{ count: number }>({ steps: steps.conventional() });
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
		steps.semver();
		steps.conventionalKind({ types: { docs: "none" } });
		// @ts-expect-error not a kind
		steps.conventionalKind({ types: { docs: "huge" } });
	});

	it("type preset options by step name", () => {
		steps.conventional({
			"github-release": false,
			"conventional-kind": { types: { docs: "none" }, fallback: "none" },
			semver: { shiftPreMajor: false },
		});
		// @ts-expect-error not a step of the preset
		steps.conventional({ nope: false });
		// @ts-expect-error wrong option type
		steps.conventional({ semver: { shiftPreMajor: "no" } });
	});
});
