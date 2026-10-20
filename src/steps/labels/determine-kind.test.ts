import type { Change } from "../../core/types.ts";
import { runStep } from "../../testing/step.ts";
import { labelsDetermineKind } from "./determine-kind.ts";

const pr = (number: number, ...labels: string[]): Change => ({
	title: `PR ${number}`,
	labels,
	reason: `PR #${number}`,
});

const kind = (
	changes: Change[],
	options?: Parameters<typeof labelsDetermineKind>[0],
) =>
	runStep(labelsDetermineKind(options), { previousVersion: "1.0.0", changes });

describe("labels/determine-kind", () => {
	it("takes the highest kind of any label, and none without changes", async () => {
		expect(
			await kind([pr(1, "bug"), pr(2, "Enhancement", "docs"), pr(3)]),
		).toEqual({
			kind: "feature",
			reason: "'Enhancement' label (PR #2)",
		});
		expect(await kind([pr(1, "bug", "breaking")])).toEqual({
			kind: "breaking",
			reason: "'breaking' label (PR #1)",
		});
		expect(await kind([pr(1, "docs")])).toEqual({
			kind: "fix",
			reason: "no label in kinds (PR #1)",
		});
		expect(await kind([])).toEqual({ kind: "none", reason: "no changes" });
	});

	it("maps labels to kinds, ignoring case, with a fallback", async () => {
		const options = {
			kinds: { added: "feature", removed: "breaking", Fixed: "fix" },
			fallback: "none",
		} as const;
		expect((await kind([pr(1, "Fixed"), pr(2, "docs")], options)).kind).toBe(
			"fix",
		);
		expect((await kind([pr(1, "ADDED")], options)).kind).toBe("feature");
		expect((await kind([pr(1, "enhancement")], options)).kind).toBe("none");
	});
});
