import type { Change } from "../../core/types.ts";
import { runStep } from "../../testing/step.ts";
import { labelsBuildNotes } from "./determine-notes.ts";

const pr = (title: string, ...labels: string[]): Change => ({
	title,
	labels,
	reason: "PR #1",
	link: { label: "#1", url: "https://example.com/pull/1" },
});

const notes = (
	changes: Change[],
	options?: Parameters<typeof labelsBuildNotes>[0],
) =>
	runStep(labelsBuildNotes(options), {
		previousVersion: "1.0.0",
		changes,
		kind: "feature",
		version: "1.1.0",
	});

describe("labels/determine-notes", () => {
	it("groups changes by label, in the first section that fits", async () => {
		const output = await notes(
			[
				pr("Drop Node 18", "breaking", "enhancement"),
				pr("Add dark mode", "Enhancement"),
				pr("Fix crash", "bug"),
				pr("Bump deps", "dependencies"),
				pr("Fix typo in docs", "skip-changelog", "bug"),
				pr("Unlabeled"),
			],
			{ links: false },
		);
		expect(output.notes).toBe(
			[
				"### Breaking Changes",
				"",
				"- Drop Node 18",
				"",
				"### Features",
				"",
				"- Add dark mode",
				"",
				"### Bug Fixes",
				"",
				"- Fix crash",
				"",
				"### Other",
				"",
				"- Bump deps",
				"- Unlabeled",
			].join("\n"),
		);
		expect(output.reason).toBe(
			"feature release; breaking changes: 1, features: 1, bug fixes: 1, other: 2",
		);
	});

	it("uses custom sections, with links and descriptions", async () => {
		const output = await notes(
			[
				{
					...pr("Added a thing", "Added"),
					description: "More on it,\n\nover lines.",
				},
				pr("Removed a thing", "Removed"),
				{
					description: "Untitled\nsecond line",
					labels: ["Added"],
					reason: "x",
				},
			],
			{
				sections: [
					{ title: "Added", labels: ["added"] },
					{ title: "Fixed", labels: ["fixed"] },
				],
				other: false,
				descriptions: true,
			},
		);
		expect(output.notes).toBe(
			[
				"### Added",
				"",
				"- Added a thing ([#1](https://example.com/pull/1))",
				"  More on it,",
				"",
				"  over lines.",
				"- Untitled",
				"  second line",
			].join("\n"),
		);
	});

	it("says when there are no entries", async () => {
		expect(await notes([{ reason: "empty" }])).toEqual({
			notes: "",
			reason: "feature release; no entries",
		});
	});
});
