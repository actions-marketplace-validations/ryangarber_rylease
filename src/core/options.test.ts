import * as zm from "zod/mini";
import { joinPath, OptionsError, parseOptions, z } from "./options.ts";

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
		expect((error as OptionsError).message).toBe(
			(error as OptionsError).issues.join("\n"),
		);
	});

	it("rejects anything but options", () => {
		expect(() => parseOptions(shape, "x", "step")).toThrow(
			"step: Invalid input: expected object, received string",
		);
	});

	it("accepts zod/mini schemas", () => {
		expect(
			parseOptions({ n: zm._default(zm.number(), 3) }, {}, "step"),
		).toEqual({ n: 3 });
	});
});

describe("joinPath", () => {
	it.each([
		[[], "a"],
		[["b", "c-d"], "a.b.c-d"],
		[["files", 0], "a.files[0]"],
		[["chore(deps)"], 'a["chore(deps)"]'],
		[["git/commit"], 'a["git/commit"]'],
	] as const)("%o → %s", (keys, path) => {
		expect(joinPath("a", keys)).toBe(path);
	});
});
