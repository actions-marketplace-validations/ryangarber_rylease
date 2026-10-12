import { describe, expect, it } from "vitest";
import * as zm from "zod/mini";
import { definePreset, defineStep } from "./define.ts";
import { OptionsError, parseOptions, z } from "./options.ts";
import type { StepInput } from "./types.ts";

const shape = {
	name: z.string(),
	count: z.number().default(1),
	kinds: z.record(z.string(), z.enum(["a", "b"])).default({}),
};

describe("parseOptions", () => {
	it("applies defaults", () => {
		expect(parseOptions(shape, { name: "x" }, "step")).toEqual({
			name: "x",
			count: 1,
			kinds: {},
		});
		expect(
			parseOptions({ flag: z.boolean().default(true) }, null, "s"),
		).toEqual({ flag: true });
	});

	it("reports every problem with its path", () => {
		const error = (() => {
			try {
				parseOptions(
					shape,
					{ count: "2", kinds: { "chore(deps)": "c" }, extra: 1 },
					"steps[0].step",
				);
			} catch (e) {
				return e;
			}
		})();
		expect(error).toBeInstanceOf(OptionsError);
		expect((error as OptionsError).issues).toEqual([
			"steps[0].step.name: Invalid input: expected string, received undefined",
			"steps[0].step.count: Invalid input: expected number, received string",
			'steps[0].step.kinds["chore(deps)"]: Invalid option: expected one of "a"|"b"',
			'steps[0].step: Unrecognized key: "extra"',
		]);
	});

	it("accepts zod/mini schemas", () => {
		expect(
			parseOptions({ n: zm._default(zm.number(), 3) }, {}, "step"),
		).toEqual({ n: 3 });
	});
});

const greet = defineStep({
	type: "release-notes",
	name: "greet",
	description: "Greets.",
	options: { greeting: z.string().default("hi") },
	run: ({ notes, options }) => ({
		notes: `${options.greeting}\n${notes}`,
		reason: `said ${options.greeting}`,
	}),
});

const input = {
	previousVersion: "1.0.0",
	changes: [],
	kind: "patch",
	version: "1.0.1",
	notes: "notes",
	env: { cwd: "/", branch: "main", dryRun: false },
	context: undefined,
	history: [],
} satisfies StepInput<"release-notes">;

describe("defineStep", () => {
	it("creates configured steps and exposes its definition", async () => {
		expect([greet.type, greet.name, greet.description]).toEqual([
			"release-notes",
			"greet",
			"Greets.",
		]);
		expect(Object.keys(greet.options)).toEqual(["greeting"]);
		const step = greet({ greeting: "hello" });
		expect(step).toMatchObject({ type: "release-notes", name: "greet" });
		expect(await step.run(input)).toEqual({
			notes: "hello\nnotes",
			reason: "said hello",
		});
		expect((await greet().run(input)).notes).toBe("hi\nnotes");
	});

	it("validates options when called", () => {
		expect(() => greet({ greeting: 1 } as never)).toThrow(
			"greet.greeting: Invalid input: expected string, received number",
		);
	});
});

describe("definePreset", () => {
	const shout = defineStep({
		type: "release-notes",
		name: "shout",
		run: ({ notes }) => ({
			notes: (notes ?? "").toUpperCase(),
			reason: "shouted",
		}),
	});
	const preset = definePreset({ name: "both", steps: [greet, shout] });

	it("creates every step with its options, dropping those set to false", () => {
		expect(preset.name).toBe("both");
		expect(preset.steps).toEqual([greet, shout]);
		expect(preset().map((step) => step.name)).toEqual(["greet", "shout"]);
		expect(
			preset({ shout: false, greet: { greeting: "yo" } }).map((s) => s.name),
		).toEqual(["greet"]);
	});

	it("rejects unknown steps and bad options with their path", () => {
		expect(() => preset({ nope: {} } as never)).toThrow(
			"both: 'nope' isn't one of its steps (greet, shout)",
		);
		expect(() => preset({ greet: { greeting: 1 } } as never)).toThrow(
			"both.greet.greeting: Invalid input",
		);
	});
});
