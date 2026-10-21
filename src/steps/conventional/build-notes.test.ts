import type { Change } from "../../core/types.ts";
import { change, runStep } from "../../testing/step.ts";
import { conventionalBuildNotes } from "./build-notes.ts";

const major = { previousVersion: "1.0.0", kind: "breaking", version: "2.0.0" };
const patch = { previousVersion: "1.0.0", kind: "fix", version: "1.0.1" };

describe("conventional/build-notes", () => {
	it("groups changes into breaking changes, types and other", async () => {
		const output = await runStep(conventionalBuildNotes(), {
			...major,
			kind: "breaking",
			changes: [
				change("feat(api)!: drop node 18"),
				change("fix: handle nulls"),
				change("perf: faster"),
				change("revert: undo thing"),
				change("chore(deps): bump vitest"),
				change("fix: old api", "BREAKING CHANGE: gone"),
				change("feat: add thing"),
				{ description: "Untitled change\nmore", reason: "issue #3" },
			],
		});
		expect(output.notes).toBe(
			[
				"### Breaking Changes",
				"",
				"- **api:** drop node 18",
				"- old api",
				"",
				"### Features",
				"",
				"- add thing",
				"",
				"### Bug Fixes",
				"",
				"- handle nulls",
				"",
				"### Performance Improvements",
				"",
				"- faster",
				"",
				"### Reverts",
				"",
				"- undo thing",
				"",
				"### Other",
				"",
				"- **deps:** bump vitest",
				"- Untitled change",
			].join("\n"),
		);
		expect(output.reason).toBe(
			"breaking release; breaking changes: 2, features: 1, bug fixes: 1, performance improvements: 1, reverts: 1, other: 2",
		);
	});

	it("uses custom sections, and can leave out the rest", async () => {
		const output = await runStep(
			conventionalBuildNotes({
				sections: [{ title: "Dependencies", types: ["chore(deps)", "build"] }],
				other: false,
			}),
			{
				...patch,
				kind: "fix",
				changes: [
					change("chore(deps): bump a"),
					change("feat: b"),
					change("build: c"),
				],
			},
		);
		expect(output.notes).toBe("### Dependencies\n\n- **deps:** bump a\n- c");
		expect(output.reason).toBe("fix release; dependencies: 2");
	});

	it("can mark breaking changes in their own section instead", async () => {
		const output = await runStep(conventionalBuildNotes({ breaking: false }), {
			...major,
			kind: "breaking",
			changes: [change("feat(api)!: drop node 18"), change("feat: add thing")],
		});
		expect(output.notes).toBe(
			"### Features\n\n- **api:** drop node 18 **(breaking)**\n- add thing",
		);
	});

	it("links changes to their source", async () => {
		const linked: Change = {
			...change("fix: handle nulls"),
			link: { label: "abc1234", url: "https://example.com/c/abc1234" },
		};
		const input = {
			...patch,
			kind: "fix" as const,
			changes: [linked, change("fix: unlinked")],
		};
		expect((await runStep(conventionalBuildNotes(), input)).notes).toBe(
			"### Bug Fixes\n\n- handle nulls ([abc1234](https://example.com/c/abc1234))\n- unlinked",
		);
		expect(
			(await runStep(conventionalBuildNotes({ links: false }), input)).notes,
		).toBe("### Bug Fixes\n\n- handle nulls\n- unlinked");
	});

	it("leaves out changes without text, and says when there are none", async () => {
		const output = await runStep(conventionalBuildNotes(), {
			...patch,
			kind: "fix",
			changes: [{ reason: "empty" }, { description: "  ", reason: "blank" }],
		});
		expect(output).toEqual({ notes: "", reason: "fix release; no entries" });
	});
});
