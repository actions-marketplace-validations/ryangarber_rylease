import { semver } from "../schemes/semver.ts";
import { root } from "../testing/step.ts";
import { definePreset, defineRelease, defineStep, when } from "./define.ts";
import type { History } from "./history.ts";
import { z } from "./options.ts";
import type { EachStepDefinition, Step, StepInput } from "./types.ts";

const greet = defineStep({
	type: "build-notes",
	name: "greet",
	description: "Greets.",
	options: {
		greeting: z.string().default("hi"),
		loud: z.boolean().default(false),
	},
	run: ({ notes, options }) => {
		const greeting = options.loud
			? options.greeting.toUpperCase()
			: options.greeting;
		return { notes: `${greeting}\n${notes}`, reason: `said ${greeting}` };
	},
});

const shout = defineStep({
	type: "build-notes",
	name: "shout",
	run: ({ notes }) => ({
		notes: (notes ?? "").toUpperCase(),
		reason: "shouted",
	}),
});

const input = {
	component: root,
	previousVersion: "1.0.0",
	changes: [],
	kind: "fix",
	version: "1.0.1",
	tag: "v1.0.1",
	placeholders: { version: "1.0.1", tag: "v1.0.1" },
	dependencies: [],
	notes: "notes",
	env: { cwd: "/", branch: "main", dryRun: false },
	context: undefined,
	history: [],
} satisfies StepInput<"build-notes">;

describe("defineStep", () => {
	it("creates configured steps and exposes its definition", async () => {
		expect([greet.type, greet.name, greet.description]).toEqual([
			"build-notes",
			"greet",
			"Greets.",
		]);
		expect(Object.keys(greet.options)).toEqual(["greeting", "loud"]);
		const step = greet({ greeting: "hello" });
		expect(step).toMatchObject({ type: "build-notes", name: "greet" });
		expect(greet.kind).toBe("step");
		expect(greet.scope).toBe("each");
		expect(step.if).toBeUndefined();
		expect(await step.run(input)).toEqual({
			notes: "hello\nnotes",
			reason: "said hello",
		});
		expect((await greet().run(input)).notes).toBe("hi\nnotes");
	});

	it("has no options unless it declares them", () => {
		expect(shout.options).toEqual({});
		expect(shout.description).toBeUndefined();
		expect(() => shout({ x: 1 } as never)).toThrow(
			'shout: Unrecognized key: "x"',
		);
	});

	it("declares its scope, needs and provides", () => {
		const count = defineStep({
			type: "release",
			name: "count",
			scope: "all",
			needs: ["changes.labels"],
			provides: ["version.semver"],
			run: ({ components }) => ({
				output: components.length,
				reason: "counted",
			}),
		});
		expect([count.scope, count.needs, count.provides]).toEqual([
			"all",
			["changes.labels"],
			["version.semver"],
		]);
		expect(count()).toMatchObject({
			scope: "all",
			needs: ["changes.labels"],
			provides: ["version.semver"],
		});
		expect(Object.keys(greet())).toEqual(["type", "name", "run"]);
	});

	it("validates options when called", () => {
		expect(() => greet({ greeting: 1 } as never)).toThrow(
			"greet.greeting: Invalid input: expected string, received number",
		);
	});
});

describe("definePreset", () => {
	const preset = definePreset({
		name: "both",
		description: "Greets, then shouts.",
		steps: [greet, shout],
		defaults: { greet: { greeting: "hey" } },
	});
	/** The notes after running each step in turn. */
	const notesOf = async (steps: Step[]) => {
		let notes = input.notes;
		for (const step of steps) {
			const run = step.run as EachStepDefinition<"build-notes">["run"];
			notes = (await run({ ...input, notes })).notes;
		}
		return notes;
	};

	it("exposes its definition", () => {
		expect(preset.name).toBe("both");
		expect(preset.description).toBe("Greets, then shouts.");
		expect(preset.steps).toEqual([greet, shout]);
		expect(preset.defaults).toEqual({ greet: { greeting: "hey" } });
	});

	it("creates every step with its options, dropping those set to false", async () => {
		expect(preset().map((step) => step.name)).toEqual(["greet", "shout"]);
		expect(await notesOf(preset())).toBe("HEY\nNOTES");
		const greeted = preset({ shout: false, greet: { loud: true } });
		expect(greeted.map((s) => s.name)).toEqual(["greet"]);
		// Its own defaults apply under the caller's options.
		expect(await notesOf(greeted)).toBe("HEY\nnotes");
		expect(await notesOf(preset({ greet: { greeting: "yo" } }))).toBe(
			"YO\nNOTES",
		);
	});

	it("rejects unknown steps and bad options with their path", () => {
		expect(() => preset({ nope: {} } as never)).toThrow(
			"both: 'nope' isn't one of its steps (greet, shout)",
		);
		expect(() => preset({ greet: { greeting: 1 } } as never)).toThrow(
			"both.greet.greeting: Invalid input",
		);
		expect(() => preset({ greet: "loud" } as never)).toThrow(
			"both.greet: Invalid input: expected object, received string",
		);
	});
});

describe("when", () => {
	const ready = (version: string) => ({ ...input, version });

	it("makes a step conditional, describing the condition", () => {
		const step = when(
			greet(),
			Object.assign(({ version }: StepInput<"build-notes">) => version > "1", {
				source: "version > '1'",
			}),
		);
		expect(step.if?.source).toBe("version > '1'");
		expect(step.if?.(ready("2.0.0"))).toBe(true);
		expect(step.if?.(ready("0.1.0"))).toBe(false);
	});

	it("keeps the step's own condition", () => {
		const step = when(
			when(greet(), ({ version }) => version.startsWith("2")),
			({ env }) => !env.dryRun,
		);
		expect(step.if?.source).toBe("its condition && its own condition");
		expect(step.if?.(ready("2.0.0"))).toBe(true);
		expect(step.if?.(ready("1.0.0"))).toBe(false);
		expect(
			step.if?.({ ...ready("2.0.0"), env: { ...input.env, dryRun: true } }),
		).toBe(false);
	});
});

const none = (name = "none"): History => ({
	name,
	find: async () => undefined,
});

describe("defineRelease", () => {
	const tagged = definePreset({
		name: "tagged",
		steps: [greet, shout],
		scheme: semver,
		history: () => none("tags"),
	});

	it("takes the scheme and history of its steps' preset, unless it sets its own", () => {
		const release = defineRelease({ steps: [...tagged(), greet()] });
		expect(release.scheme.name).toBe("semver");
		expect(release.history).toMatchObject({ name: "tags" });
		const own = defineRelease({ steps: tagged(), history: none("own") });
		expect(own.history).toMatchObject({ name: "own" });
	});

	it("makes its preset's for each call", () => {
		const [first] = tagged();
		const [second] = tagged();
		expect(first?.preset?.history).not.toBe(second?.preset?.history);
		// Kept by steps made conditional.
		const step = first && when(first, () => true);
		expect(step?.preset?.name).toBe("tagged");
	});

	it("needs a scheme and a history, with no default", () => {
		expect(() => defineRelease({ steps: [greet()] })).toThrow(
			"scheme: expected one, e.g. semver, or a preset that provides one\n" +
				"history: expected one, e.g. git/tags, or a preset that provides one",
		);
		const other = definePreset({
			name: "other",
			steps: [shout],
			history: () => none(),
		});
		expect(() => defineRelease({ steps: [...tagged(), ...other()] })).toThrow(
			"history: tagged and other each provide one; set it",
		);
	});

	it("keeps its steps and runs them", async () => {
		const steps = [
			{
				type: "read-changes" as const,
				name: "fixed",
				run: () => ({ changes: [], reason: "fixed" }),
			},
		];
		const release = defineRelease({ steps, scheme: semver(), history: none() });
		expect(release.steps).toBe(steps);
		await expect(
			release.run({ cwd: "/", branch: "main", reporter: null }),
		).rejects.toThrow("no step provided for: determine-kind, build-notes");
	});
});
