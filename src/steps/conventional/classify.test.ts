import { change } from "../../testing/step.ts";
import {
	classify,
	mentionsBreaking,
	parseSections,
	parseTitle,
	typeKey,
} from "./classify.ts";

describe("parseSections", () => {
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
		expect(parseSections("fix: x\r\n\r\nbody\r\n")).toEqual([
			{ title: "fix: x", description: "body" },
		]);
		expect(parseSections("update readme")).toEqual([]);
	});
});

describe("parseTitle", () => {
	it("parses conventional headers", () => {
		expect(parseTitle("feat(api)!: drop node 18")).toEqual({
			type: "feat",
			scope: "api",
			breaking: true,
			subject: "drop node 18",
		});
		expect(parseTitle("  chore: tidy ")).toEqual({
			type: "chore",
			breaking: false,
			subject: "tidy",
		});
		expect(parseTitle("fix(): x")).toEqual({
			type: "fix",
			breaking: false,
			subject: "x",
		});
	});

	it.each(["Update readme", "Feat: x", "feat:x", "Refs: #12"])(
		"ignores %o",
		(title) => {
			expect(parseTitle(title)).toBeUndefined();
		},
	);
});

describe("mentionsBreaking", () => {
	it.each([
		["BREAKING CHANGE: x", true],
		["BREAKING-CHANGE: x", true],
		["BREAKING CHANGES", true],
		["BREAKING", true],
		["not breaking", false],
		["UNBREAKING", false],
		[undefined, false],
	])("%o → %s", (text, breaking) => {
		expect(mentionsBreaking(text)).toBe(breaking);
	});
});

describe("classify", () => {
	it.each([
		[change("feat!: x"), "breaking", "'feat!' in title (commit abc1234)"],
		[
			change("fix(api)!: x"),
			"breaking",
			"'fix(api)!' in title (commit abc1234)",
		],
		[
			change("fix: BREAKING x"),
			"breaking",
			"'BREAKING' in title (commit abc1234)",
		],
		[
			change("fix: x", "BREAKING CHANGE: y"),
			"breaking",
			"'BREAKING' in description (commit abc1234)",
		],
		[change("feat(ui): x"), "feature", "'feat(ui)' in title (commit abc1234)"],
		[
			change("chore(deps): x"),
			"fix",
			"'chore(deps)' in title (commit abc1234)",
		],
		[change("Update readme"), "fix", "untyped change (commit abc1234)"],
		[{ reason: "issue #1" }, "fix", "untyped change (issue #1)"],
	] as const)("classifies %o as %s", (input, kind, reason) => {
		expect(classify(input)).toEqual({ kind, reason });
	});

	it("follows the rules, scoped types first", () => {
		const rules = {
			types: { docs: "none", chore: "none", "chore(deps)": "fix" },
			fallback: "feature",
		} as const;
		expect(classify(change("docs: x"), rules).kind).toBe("none");
		expect(classify(change("chore(ci): x"), rules).kind).toBe("none");
		expect(classify(change("chore(deps): x"), rules).kind).toBe("fix");
		expect(classify(change("fix: x"), rules).kind).toBe("feature");
		expect(classify(change("untyped"), rules).kind).toBe("feature");
		expect(classify(change("docs!: x"), rules).kind).toBe("breaking");
	});
});

describe("typeKey", () => {
	it("looks up `type(scope)`, then `type`", () => {
		const map = { fix: 1, "fix(a)": 2 };
		const title = (text: string) => parseTitle(text) ?? expect.fail();
		expect(typeKey(title("fix(a): x"), map)).toBe(2);
		expect(typeKey(title("fix(b): x"), map)).toBe(1);
		expect(typeKey(title("fix: x"), map)).toBe(1);
		expect(typeKey(title("feat: x"), map)).toBeUndefined();
	});
});
