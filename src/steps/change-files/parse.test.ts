import { formatChangeFile, parseChangeFile, slug } from "./parse.ts";

describe("change files", () => {
	it("parse kinds by component, a title and a description", () => {
		expect(
			parseChangeFile(
				'---\n"@x/core": feature\n# a comment\ncli: none\n---\n\nAdd it.\n\nMore\nlines.\n',
				"a.md",
			),
		).toEqual({
			kinds: { "@x/core": "feature", cli: "none" },
			title: "Add it.",
			description: "More\nlines.",
		});
	});

	it("round-trip through their format", () => {
		const file = {
			kinds: { "@x/core": "fix" as const, kind: "fix" as const },
			title: "Fix it.",
		};
		expect(formatChangeFile(file)).toBe(
			'---\n"@x/core": fix\nkind: fix\n---\nFix it.\n',
		);
		expect(parseChangeFile(formatChangeFile(file), "a.md")).toEqual(file);
	});

	it("reject malformed files", () => {
		expect(() => parseChangeFile("Fix it.", "a.md")).toThrow(
			"a.md must start with '---', then kinds by component",
		);
		expect(() => parseChangeFile("---\nkind: fix\nFix it.", "a.md")).toThrow(
			"a.md has no closing '---'",
		);
		expect(() => parseChangeFile("---\nkind fix\n---\nX", "a.md")).toThrow(
			"a.md line 2: expected 'component: kind'",
		);
		expect(() => parseChangeFile("---\nkind: fix\n---\n", "a.md")).toThrow(
			"a.md says nothing after its kinds",
		);
	});

	it("are named after their title", () => {
		expect(slug("Add dark mode (finally!)")).toBe("add-dark-mode-finally");
		expect(slug("!!!")).toBe("change");
	});
});
