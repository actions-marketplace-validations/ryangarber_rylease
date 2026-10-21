import {
	compareVersions,
	firstDifference,
	parseVersion,
	type Version,
} from "./version.ts";

const parse = (text: string): Version => parseVersion(text) ?? expect.fail();

describe("parseVersion", () => {
	it("parses any dot-separated numbers", () => {
		expect(parseVersion("v1.2.3-beta.1+abc")).toEqual({
			release: ["1", "2", "3"],
			prerelease: "beta.1",
			build: "abc",
		});
		expect(parseVersion("2026.01.3")).toEqual({
			release: ["2026", "01", "3"],
		});
		expect(parseVersion(" 24.04 ")).toEqual({ release: ["24", "04"] });
		expect(parseVersion("7")).toEqual({ release: ["7"] });
	});

	it.each(["next", "1..2", "1.2.", "1.2.3-", "1.2.3+", "x1.2.3", ""])(
		"returns undefined for %o",
		(version) => {
			expect(parseVersion(version)).toBeUndefined();
		},
	);
});

describe("compareVersions", () => {
	it("orders semver by precedence, as in the spec's example", () => {
		const ordered = [
			"1.0.0-alpha",
			"1.0.0-alpha.1",
			"1.0.0-alpha.beta",
			"1.0.0-beta",
			"1.0.0-beta.2",
			"1.0.0-beta.11",
			"1.0.0-rc.1",
			"1.0.0",
			"1.0.1",
			"1.1.0",
			"2.0.0",
		];
		expect(
			[...ordered]
				.reverse()
				.sort((a, b) => compareVersions(parse(a), parse(b))),
		).toEqual(ordered);
	});

	it("orders other schemes by value, number by number", () => {
		const ordered = [
			"9.9",
			"24.04",
			"24.10",
			"2026.01.3",
			"2026.1.10",
			"2026.10",
		];
		expect(
			[...ordered]
				.reverse()
				.sort((a, b) => compareVersions(parse(a), parse(b))),
		).toEqual(ordered);
		expect(compareVersions(parse("1.2"), parse("1.2.0"))).toBe(0);
		expect(compareVersions(parse("2026.01.0"), parse("2026.1.0"))).toBe(0);
		expect(compareVersions(parse("1.0.0+a"), parse("1.0.0+b"))).toBe(0);
	});
});

describe("firstDifference", () => {
	it("finds the first number that differs", () => {
		expect(firstDifference(parse("1.2.3"), parse("2.0.0"))).toBe(0);
		expect(firstDifference(parse("2026.09.4"), parse("2026.10.0"))).toBe(1);
		expect(firstDifference(parse("1.2"), parse("1.2.0.1"))).toBe(3);
		expect(firstDifference(parse("1.2"), parse("1.2.0-rc.1"))).toBeUndefined();
	});
});
