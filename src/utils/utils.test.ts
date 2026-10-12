import { describe, expect, it } from "vitest";
import { mentionsBreaking, parseSections, parseTitle } from "./conventional.ts";
import { parseGitHubRepo } from "./github.ts";
import { bumpVersion, formatVersion, parseVersion } from "./semver.ts";

describe("semver", () => {
	it("parses and formats", () => {
		expect(parseVersion("v1.2.3-beta.1+abc")).toEqual({
			major: 1,
			minor: 2,
			patch: 3,
			prerelease: "beta.1",
			build: "abc",
		});
		expect(formatVersion(parseVersion("1.2.3-rc.0"))).toBe("1.2.3-rc.0");
		expect(() => parseVersion("1.2")).toThrow(/not a valid/);
	});

	it.each([
		["1.2.3", "major", "2.0.0"],
		["1.2.3", "minor", "1.3.0"],
		["1.2.3", "patch", "1.2.4"],
		["1.2.3-beta.1", "patch", "1.2.4"],
	] as const)("bumps %s by %s to %s", (from, kind, to) => {
		expect(formatVersion(bumpVersion(parseVersion(from), kind))).toBe(to);
	});
});

describe("conventional", () => {
	it("splits a message into sections", () => {
		const message = [
			"Merge pull request #4 from me/thing",
			"",
			"feat(api)!: drop node 18",
			"",
			"Node 18 is EOL.",
			"BREAKING CHANGE: requires node 20",
			"fix: handle nulls",
			"Refs: #12",
		].join("\n");
		expect(parseSections(message)).toEqual([
			{
				title: "feat(api)!: drop node 18",
				description: "Node 18 is EOL.\nBREAKING CHANGE: requires node 20",
			},
			{ title: "fix: handle nulls", description: "Refs: #12" },
		]);
		expect(parseSections("update readme")).toEqual([]);
	});

	it("parses titles", () => {
		expect(parseTitle("feat(api)!: drop node 18")).toEqual({
			type: "feat",
			scope: "api",
			breaking: true,
			subject: "drop node 18",
		});
		expect(parseTitle("chore: tidy")).toEqual({
			type: "chore",
			breaking: false,
			subject: "tidy",
		});
		expect(parseTitle("Update readme")).toBeUndefined();
	});

	it("detects breaking mentions", () => {
		expect(mentionsBreaking("BREAKING CHANGE: x")).toBe(true);
		expect(mentionsBreaking("BREAKING-CHANGE: x")).toBe(true);
		expect(mentionsBreaking("not breaking")).toBe(false);
		expect(mentionsBreaking(undefined)).toBe(false);
	});
});

describe("parseGitHubRepo", () => {
	it.each([
		["git@github.com:ryangarber/rylease.git", "ryangarber/rylease"],
		["https://github.com/ryangarber/rylease", "ryangarber/rylease"],
		["https://github.com/ryangarber/rylease.git", "ryangarber/rylease"],
		["https://gitlab.com/a/b.git", undefined],
	])("%s → %s", (url, repo) => {
		expect(parseGitHubRepo(url)).toBe(repo);
	});
});
