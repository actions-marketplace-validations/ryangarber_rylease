import { change, runStep } from "../../testing/step.ts";
import { conventionalDetermineKind } from "./determine-kind.ts";

describe("conventional/determine-kind", () => {
	const base = { previousVersion: "1.0.0" };

	it("takes the highest kind, and none without changes", async () => {
		const step = conventionalDetermineKind();
		expect(
			await runStep(step, {
				...base,
				changes: [change("fix: a"), change("feat: b"), change("chore: c")],
			}),
		).toEqual({ kind: "feature", reason: "'feat' in title (commit abc1234)" });
		expect(
			await runStep(step, {
				...base,
				changes: [change("fix: a"), change("feat!: b"), change("feat: c")],
			}),
		).toEqual({
			kind: "breaking",
			reason: "'feat!' in title (commit abc1234)",
		});
		expect(await runStep(step, { ...base, changes: [] })).toEqual({
			kind: "none",
			reason: "no changes",
		});
	});

	it("maps types and scopes to kinds, on top of feat: feature", async () => {
		const step = conventionalDetermineKind({
			types: { docs: "none", chore: "none", "chore(deps)": "fix" },
			fallback: "none",
		});
		const kind = async (...titles: string[]) =>
			(
				await runStep(step, {
					...base,
					changes: titles.map((title) => change(title)),
				})
			).kind;
		expect(await kind("docs: a", "chore: b", "untyped")).toBe("none");
		expect(await kind("docs: a", "chore(deps): b")).toBe("fix");
		expect(await kind("docs: a", "feat: b")).toBe("feature");
		expect(await kind("docs!: a")).toBe("breaking");
		expect(
			await runStep(step, { ...base, changes: [change("docs: a")] }),
		).toEqual({
			kind: "none",
			reason: "'docs' in title (commit abc1234)",
		});
	});

	it("can make feat a patch", async () => {
		const step = conventionalDetermineKind({ types: { feat: "fix" } });
		expect(
			(await runStep(step, { ...base, changes: [change("feat: a")] })).kind,
		).toBe("fix");
	});

	it("rejects unknown kinds", () => {
		expect(() =>
			conventionalDetermineKind({ fallback: "huge" } as never),
		).toThrow("conventional/determine-kind.fallback: Invalid option");
	});
});
