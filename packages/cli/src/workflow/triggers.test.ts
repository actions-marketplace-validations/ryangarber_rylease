import { globRegex, triggers } from "./triggers.ts";

const event = (
	name: string,
	rest: Partial<Parameters<typeof triggers>[1]> = {},
) => ({
	name,
	ref: "refs/heads/main",
	changedFiles: async () => ["src/a.ts", "README.md"],
	...rest,
});

describe("triggers", () => {
	it("matches GitHub's filter patterns", () => {
		expect(globRegex("release/*").test("release/1.0")).toBe(true);
		expect(globRegex("release/*").test("release/1/0")).toBe(false);
		expect(globRegex("release/**").test("release/1/0")).toBe(true);
		expect(globRegex("**/*.md").test("README.md")).toBe(true);
		expect(globRegex("v[12].*").test("v2.0")).toBe(true);
		expect(globRegex("v+(1)").test("v1")).toBe(false);
	});

	it("filters by event, branch, tag and type", async () => {
		expect(await triggers({ push: null }, event("pull_request"))).toEqual({
			fires: false,
			reason: "it doesn't run on pull_request, only on push",
		});
		expect(
			(await triggers({ push: { branches: ["main", "dev"] } }, event("push")))
				.fires,
		).toBe(true);
		expect(
			await triggers(
				{ push: { branches: ["release/**", "!release/old"] } },
				event("push", { ref: "refs/heads/release/old" }),
			),
		).toMatchObject({ fires: false });
		expect(
			await triggers(
				{ push: { branches: ["main"] } },
				event("push", { ref: "refs/tags/v1" }),
			),
		).toEqual({
			fires: false,
			reason: "it filters branches, so no tag pushes run it",
		});
		expect(
			(
				await triggers(
					{ push: { tags: ["v*"] } },
					event("push", { ref: "refs/tags/v1" }),
				)
			).fires,
		).toBe(true);
		expect(
			await triggers(
				{ pull_request: null },
				event("pull_request", { type: "closed", baseRef: "main" }),
			),
		).toMatchObject({
			fires: false,
			reason:
				"pull_request 'closed' isn't one of its types: opened, synchronize, reopened",
		});
		expect(
			(
				await triggers(
					{ pull_request: { branches: ["main"] } },
					event("pull_request", { type: "opened", baseRef: "main" }),
				)
			).fires,
		).toBe(true);
	});

	it("filters workflow_run by workflow and branch", async () => {
		const on = {
			workflow_run: {
				workflows: ["check"],
				types: ["completed"],
				branches: ["main", "dev"],
			},
		};
		const run = (rest: object) =>
			event("workflow_run", {
				type: "completed",
				workflow: "check",
				headBranch: "main",
				...rest,
			});
		expect((await triggers(on, run({}))).fires).toBe(true);
		expect(await triggers(on, run({ workflow: "lint" }))).toMatchObject({
			fires: false,
			reason: "it runs after check, not lint",
		});
		expect(await triggers(on, run({ headBranch: "feature" }))).toMatchObject({
			fires: false,
		});
	});

	it("filters by changed paths", async () => {
		expect(
			(await triggers({ push: { paths: ["src/**"] } }, event("push"))).fires,
		).toBe(true);
		expect(
			await triggers({ push: { paths: ["docs/**"] } }, event("push")),
		).toMatchObject({ fires: false });
		expect(
			await triggers({ push: { "paths-ignore": ["**"] } }, event("push")),
		).toMatchObject({ fires: false });
		expect(
			(await triggers({ push: { "paths-ignore": ["*.md"] } }, event("push")))
				.fires,
		).toBe(true);
	});
});
