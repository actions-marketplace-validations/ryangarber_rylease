import type { ComponentReport, ReleaseReport } from "./engine.ts";
import { markdownProblems, markdownSummary } from "./summary.ts";

const component = (
	overrides: Partial<ComponentReport> = {},
): ComponentReport => ({
	name: "root",
	path: ".",
	status: "released",
	previousVersion: "1.0.0",
	kind: "feature",
	version: "1.1.0",
	notes: "## Features\n\n- a",
	dependencies: [],
	releases: [],
	...overrides,
});

const report = (
	overrides: Partial<ReleaseReport> = {},
	components = [component()],
): ReleaseReport => ({
	env: { cwd: "/p", branch: "main", dryRun: false },
	status: "released",
	components,
	releases: [],
	records: [
		{
			type: "version",
			name: "semver",
			status: "ok",
			durationMs: 0.4,
			reason: "1.1.0: 'feature' from 1.0.0, bumps minor",
		},
		{
			type: "release",
			name: "announce",
			status: "skipped",
			durationMs: 0,
			reason: "`a | b` is false\nreally",
		},
	],
	...overrides,
});

describe("markdownSummary", () => {
	it("shows the release, its steps and its notes", () => {
		expect(markdownSummary(report())).toBe(
			[
				"### rylease · **1.0.0** → **1.1.0** (feature) · released",
				"",
				"On `main`.",
				"",
				"| | Type | Step | Time | |",
				"|:-:|---|---|--:|---|",
				"| ✅ | `version` | `semver` | <1ms | 1.1.0: 'feature' from 1.0.0, bumps minor |",
				"| ⚪ | `release` | `announce` |  | `a \\| b` is false<br>really |",
				"",
				"<details open><summary>Release notes</summary>",
				"",
				"## Features",
				"",
				"- a",
				"",
				"</details>",
				"",
				"",
			].join("\n"),
		);
	});

	it("says when it's a dry run, or nothing was released, or it failed", () => {
		const dry = markdownSummary(
			report({ env: { cwd: "/", branch: "dev", dryRun: true } }),
		);
		expect(dry).toMatch(
			/^### rylease dry run · \*\*1\.0\.0\*\* → \*\*1\.1\.0\*\* \(feature\) · would release\n\nOn `dev`, without side effects\.\n/,
		);
		expect(
			markdownSummary(
				report({ status: "unchanged" }, [component({ status: "unchanged" })]),
			),
		).toMatch(/^### rylease · \*\*1\.0\.0\*\* · nothing to release\n/);
		const failed = markdownSummary(report({ status: "failed" }));
		expect(failed).toMatch(/^### ❌ rylease · release failed\n/);
		expect(failed).not.toContain("Release notes");
		expect(markdownProblems(["steps[0].uses: <nope>"])).toBe(
			"### ❌ rylease · invalid input\n\n- steps[0].uses: &lt;nope>\n\n",
		);
	});

	it("lists each component, and their notes", () => {
		const summary = markdownSummary(
			report({}, [
				component({ name: "core" }),
				component({ name: "cli", status: "unchanged", kind: "none" }),
			]),
		);
		expect(summary).toContain(
			[
				"### rylease · released",
				"",
				"On `main`.",
				"",
				"- `core`: **1.0.0** → **1.1.0** (feature) · released",
				"- `cli`: **1.0.0** · nothing to release",
				"",
				"| | Component | Type | Step | Time | |",
				"|:-:|---|---|---|--:|---|",
				"| ✅ | all | `version` | `semver` | <1ms | 1.1.0: 'feature' from 1.0.0, bumps minor |",
			].join("\n"),
		);
		expect(summary).toContain("<summary>Release notes of core 1.1.0</summary>");
		expect(summary).not.toContain("of cli");
	});
});

describe("markdownSummary of a pending release", () => {
	it("says it's proposed, and when it's released", () => {
		const summary = markdownSummary(
			report({ status: "pending", deferred: "released when #12 merges" }, [
				component({ status: "pending" }),
			]),
		);
		expect(summary).toMatch(
			/^### rylease · \*\*1\.0\.0\*\* → \*\*1\.1\.0\*\* \(feature\) · proposed\n\nOn `main`\. Released when #12 merges\.\n/,
		);
		expect(summary).toContain("<summary>Release notes</summary>");
	});
});
