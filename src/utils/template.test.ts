import { fill, templatePattern, versionValues } from "./template.ts";

describe("fill", () => {
	it("replaces every placeholder", () => {
		expect(
			fill("v{version} ({date}) v{version}", { version: "1", date: "d" }),
		).toBe("v1 (d) v1");
		expect(fill("no placeholders", {})).toBe("no placeholders");
	});

	it("rejects unknown placeholders, listing the known ones", () => {
		expect(() => fill("v{build}", { version: "1", major: "1" })).toThrow(
			"unknown placeholder {build} in 'v{build}'; use {version} or {major}",
		);
	});
});

describe("templatePattern", () => {
	it("captures the placeholder, matching the rest literally", () => {
		const pattern = templatePattern("v{version}.(x)", "version");
		expect(pattern.exec("v1.2.3.(x)")?.[1]).toBe("1.2.3");
		expect(pattern.test("v1.2.3.x")).toBe(false);
		expect(pattern.test("av1.2.3.(x)")).toBe(false);
	});

	it("needs exactly that placeholder", () => {
		expect(() => templatePattern("v{major}", "version")).toThrow(
			"unknown placeholder {major} in 'v{major}'",
		);
		expect(() => templatePattern("latest", "version")).toThrow(
			"'latest' has no {version} placeholder",
		);
	});
});

describe("versionValues", () => {
	it("splits a version into its parts", () => {
		expect(versionValues("1.2.3-rc.1")).toEqual({
			version: "1.2.3-rc.1",
			major: "1",
			minor: "2",
			patch: "3",
		});
		expect(versionValues("2026.01")).toEqual({
			version: "2026.01",
			major: "2026",
			minor: "01",
		});
		expect(versionValues("next")).toEqual({ version: "next" });
	});

	it("fails on a part the version doesn't have", () => {
		expect(() => fill("v{patch}", versionValues("24.04"))).toThrow(
			"unknown placeholder {patch} in 'v{patch}'; use {version} or {major} or {minor}",
		);
	});
});
