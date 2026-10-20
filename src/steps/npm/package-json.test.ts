import { setPackageJsonVersion, versionOf } from "./package-json.ts";

describe("versionOf", () => {
	it("needs a non-empty version", () => {
		expect(versionOf({ version: "1.0.0" }, "a.json")).toBe("1.0.0");
		for (const json of [{}, { version: "" }, { version: 1 }]) {
			expect(() => versionOf(json, "a.json")).toThrow(
				"a.json has no 'version'",
			);
		}
	});
});

describe("setPackageJsonVersion", () => {
	it.each([
		["two spaces", '{\n  "name": "a",\n  "version": "1.0.0"\n}\n'],
		["tabs", '{\n\t"name": "a",\n\t"version": "1.0.0"\n}\n'],
		["no trailing newline", '{\n    "version": "1.0.0"\n}'],
	])("keeps %s", (_, text) => {
		expect(setPackageJsonVersion(text, "2.0.0", new Map())).toEqual({
			text: text.replace('"1.0.0"', '"2.0.0"'),
			dependencies: [],
		});
	});

	it("adds a missing version, indenting with tabs on one line", () => {
		expect(setPackageJsonVersion('{"name":"a"}', "1.0.0", new Map()).text).toBe(
			'{\n\t"name": "a",\n\t"version": "1.0.0"\n}',
		);
	});

	it("points dependencies on released packages at them, keeping operators", () => {
		const text = JSON.stringify({
			version: "1.0.0",
			dependencies: { a: "^1.0.0", b: "workspace:*", c: "1.2.0", d: "1.x" },
			devDependencies: { a: "~1.0.0" },
		});
		const packages = new Map([
			["a", "2.0.0"],
			["b", "2.0.0"],
			["c", "1.3.0"],
			["d", "2.0.0"],
		]);
		const { text: written, dependencies } = setPackageJsonVersion(
			text,
			"1.1.0",
			packages,
		);
		expect(JSON.parse(written)).toEqual({
			version: "1.1.0",
			dependencies: { a: "^2.0.0", b: "workspace:*", c: "1.3.0", d: "1.x" },
			devDependencies: { a: "~2.0.0" },
		});
		expect(dependencies).toEqual(["a@^2.0.0", "c@1.3.0", "a@~2.0.0"]);
	});
});
