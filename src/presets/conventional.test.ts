import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { npmWorkspaces } from "../components/index.ts";
import { defineRelease } from "../core/define.ts";
import type { AllStepDefinition } from "../core/types.ts";
import { fsVersionFile, gitTags } from "../histories/index.ts";
import { calver } from "../schemes/index.ts";
import {
	componentsDependents,
	fsWriteChanges,
	fsWriteVersion,
	gitCommit,
} from "../steps/index.ts";
import { pkg, useRepo } from "../testing/repo.ts";
import { released, runStep } from "../testing/step.ts";
import { git } from "../utils/git.ts";
import { conventional } from "./conventional.ts";

const repo = useRepo();

/** Tags, or for a project that's never been tagged, package.json. */
const history = [gitTags(), fsVersionFile({ format: "npm" })];

/** The preset, plus the version in package.json and a changelog, committed. */
function node() {
	// Listed first, so they run before the preset's release steps.
	return [
		fsWriteVersion({ format: "npm" }),
		fsWriteChanges(),
		gitCommit(),
		...conventional({
			"github/create-release": { repo: "me/demo", token: "token" },
		}),
	];
}

const notes = [
	"### Breaking Changes",
	"",
	"- **x:** change b",
	"",
	"### Features",
	"",
	"- add c",
	"- add a",
].join("\n");

describe("conventional", () => {
	it("releases from the latest tag, and only tags", async () => {
		await git(repo.cwd, "tag", "v1.0.0", "HEAD~3");
		const tagged = await git(repo.cwd, "rev-parse", "HEAD~3");
		const head = await git(repo.cwd, "rev-parse", "HEAD");
		const report = await defineRelease({
			steps: conventional({ "github/create-release": false }),
		}).run({ cwd: repo.cwd, reporter: null });

		expect(
			report.records.map((r) => `${r.type} ${r.name}: ${r.reason}`),
		).toEqual([
			`previous git/tags: v1.0.0 at ${tagged.slice(0, 7)}, nearest on HEAD`,
			`read-changes conventional/read-commits: 3 changes in 3 commits since ${tagged.slice(0, 7)}`,
			expect.stringMatching(
				/^determine-kind conventional\/determine-kind: 'fix\(x\)!' in title/,
			),
			"version semver: 2.0.0: 'breaking' from 1.0.0, bumps major",
			"build-notes conventional/build-notes: breaking release; breaking changes: 1, features: 2",
			`release git/create-tag: tagged v2.0.0 at ${head.slice(0, 7)} and pushed to origin`,
		]);
		expect(report.notes).toBe(notes);
		expect(await git(repo.cwd, "rev-parse", "HEAD")).toBe(head);
		expect(await git(repo.cwd, "status", "--porcelain")).toBe("");
		expect(await git(repo.remote, "rev-parse", "v2.0.0^{commit}")).toBe(head);
	});

	it("with Node steps, releases changes since the version in package.json", async () => {
		const requests: { url: string; body: Record<string, unknown> }[] = [];
		vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
			// No release yet: neither by tag, nor among drafts.
			if (init.method === "GET") {
				return url.includes("/tags/")
					? new Response("", { status: 404 })
					: Response.json([]);
			}
			requests.push({ url, body: JSON.parse(String(init.body)) });
			return Response.json({ id: 1, html_url: "https://example.com/r/1" });
		});

		const report = await defineRelease({ steps: node(), history }).run({
			cwd: repo.cwd,
			reporter: null,
		});

		expect(report.status).toBe("released");
		expect(report.records.map((r) => r.reason)).toEqual([
			expect.stringMatching(/^1\.0\.0 in package\.json, set in [0-9a-f]{7}$/),
			expect.stringMatching(/^3 changes in 3 commits since [0-9a-f]{7}$/),
			expect.stringMatching(/^'fix\(x\)!' in title \(commit [0-9a-f]{7}\)$/),
			"2.0.0: 'breaking' from 1.0.0, bumps major",
			"breaking release; breaking changes: 1, features: 2",
			"wrote 2.0.0 to package.json",
			"created CHANGELOG.md",
			expect.stringMatching(/^committed [0-9a-f]{7}$/),
			expect.stringMatching(
				/^tagged v2\.0\.0 at [0-9a-f]{7} and pushed to origin$/,
			),
			"created release v2.0.0: https://example.com/r/1",
		]);

		expect(report.notes).toBe(notes);
		expect(await readFile(join(repo.cwd, "package.json"), "utf8")).toBe(
			pkg("2.0.0"),
		);
		expect(await readFile(join(repo.cwd, "CHANGELOG.md"), "utf8")).toMatch(
			new RegExp(
				`^## v2\\.0\\.0 \\(\\d{4}-\\d{2}-\\d{2}\\)\n\n${notes.replace(/[*()]/g, "\\$&")}\n$`,
			),
		);

		// The release commit and its tag land together.
		const head = await git(repo.cwd, "rev-parse", "HEAD");
		expect(await git(repo.remote, "rev-parse", "main")).toBe(head);
		expect(await git(repo.remote, "rev-parse", "v2.0.0^{commit}")).toBe(head);
		expect(await git(repo.cwd, "log", "-1", "--format=%s")).toBe(
			"chore(release): v2.0.0",
		);
		expect(await git(repo.cwd, "status", "--porcelain")).toBe("");
		expect(requests).toEqual([
			{
				url: "https://api.github.com/repos/me/demo/releases",
				body: {
					tag_name: "v2.0.0",
					target_commitish: head,
					name: "v2.0.0",
					body: notes,
					draft: false,
					prerelease: false,
				},
			},
		]);

		// The next run starts from the tag and finds nothing new.
		const next = await defineRelease({ steps: node(), history }).run({
			cwd: repo.cwd,
			reporter: null,
		});
		expect(next.status).toBe("unchanged");
		expect(next.previousRef).toBe(head);
		expect(next.records.slice(0, 2).map((r) => r.reason)).toEqual([
			`v2.0.0 at ${head.slice(0, 7)}, nearest on HEAD`,
			`0 changes in 0 commits since ${head.slice(0, 7)}`,
		]);
	});

	it("changes nothing in a dry run", async () => {
		const before = await git(repo.cwd, "rev-parse", "HEAD");
		const report = await defineRelease({ steps: node(), history }).run({
			cwd: repo.cwd,
			dryRun: true,
			reporter: null,
		});

		expect(report.status).toBe("released");
		expect(report.records.slice(5).map((r) => r.reason)).toEqual([
			"would write 2.0.0 to package.json",
			"would create CHANGELOG.md",
			"would commit package.json, CHANGELOG.md",
			"would tag v2.0.0 and push to origin",
			"would create release v2.0.0 on me/demo",
		]);
		expect(await git(repo.cwd, "status", "--porcelain")).toBe("");
		expect(await git(repo.cwd, "rev-parse", "HEAD")).toBe(before);
		expect(await git(repo.cwd, "tag")).toBe("");
	});

	it("dates releases with calver instead of semver", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
		try {
			await git(repo.cwd, "tag", "v2026.10.0", "HEAD~3");
			const release = () =>
				defineRelease({
					steps: conventional({
						"github/create-release": false,
						"git/create-tag": { move: ["v{YYYY}.{MM}"] },
					}),
					scheme: calver(),
				}).run({ cwd: repo.cwd, reporter: null });
			const report = await release();
			expect(report.records[3]?.reason).toBe(
				"2026.10.1: 'breaking' from 2026.10.0, bumps MICRO",
			);
			expect(report.version).toBe("2026.10.1");
			expect(await git(repo.remote, "tag")).toBe("v2026.10\nv2026.10.1");

			await repo.commit("fix: one more");
			expect((await release()).version).toBe("2026.10.2");
		} finally {
			vi.useRealTimers();
		}
	});

	it("lets callers override its defaults", async () => {
		const [tag] = conventional({
			"conventional/read-commits": false,
			"conventional/determine-kind": false,
			"conventional/build-notes": false,
			"github/create-release": false,
			"git/create-tag": { move: ["v{major}"], push: false },
		});
		expect(tag?.name).toBe("git/create-tag");
		const output = await runStep(
			tag as AllStepDefinition<"release">,
			released("2.0.0"),
			{ cwd: repo.cwd },
		);
		expect(output.output).toEqual({
			tags: ["v2.0.0"],
			moved: ["v2"],
			pushed: false,
		});
		expect(await git(repo.remote, "tag")).toBe("");
	});
});

describe("conventional, on a prerelease channel", () => {
	const release = (branch: string) =>
		defineRelease({
			steps: conventional({
				"github/create-release": false,
				"git/create-tag": { move: ["v{major}", "{channel}"] },
			}),
			channels: { next: { branches: ["next"] } },
		}).run({ cwd: repo.cwd, branch, reporter: null });

	it("prereleases on its branch, then graduates on main", async () => {
		await git(repo.cwd, "tag", "v1.0.0", "HEAD~3");
		await git(repo.cwd, "checkout", "-q", "-b", "next");

		// The history since 1.0.0 has a breaking change.
		const first = await release("next");
		expect(first.version).toBe("2.0.0-next.1");
		expect(first.notes).toContain("### Breaking Changes");

		await repo.commit("fix: on next");
		const second = await release("next");
		expect(second.previousVersion).toBe("2.0.0-next.1");
		expect(second.version).toBe("2.0.0-next.2");
		// Only what's new since the last prerelease.
		expect(second.notes).toBe("### Bug Fixes\n\n- on next");
		// The floating tags: `next` moves, `v2` waits for the stable release.
		expect(await git(repo.remote, "tag")).toBe(
			"next\nv2.0.0-next.1\nv2.0.0-next.2",
		);

		await git(repo.cwd, "checkout", "-q", "main");
		await git(repo.cwd, "merge", "-q", "--no-ff", "-m", "merge next", "next");
		const stable = await release("main");
		expect(stable.previousVersion).toBe("1.0.0");
		expect(stable.version).toBe("2.0.0");
		// Everything since 1.0.0, the prereleases' changes included.
		expect(stable.notes).toContain("- **x:** change b");
		expect(stable.notes).toContain("- on next");
		expect(await git(repo.remote, "tag")).toBe(
			"next\nv2\nv2.0.0\nv2.0.0-next.1\nv2.0.0-next.2",
		);
	});
});

describe("conventional, in a monorepo", () => {
	const manifest = (name: string, dependencies: Record<string, string> = {}) =>
		`${JSON.stringify({ name, version: "1.0.0", dependencies }, null, 2)}\n`;

	beforeEach(async () => {
		for (const name of ["core", "cli", "docs"]) {
			await mkdir(join(repo.cwd, "packages", name), { recursive: true });
		}
		await repo.commit("chore: workspace", {
			"pnpm-workspace.yaml": "packages:\n  - packages/*\n",
			"packages/core/package.json": manifest("@x/core"),
			"packages/cli/package.json": manifest("@x/cli", { "@x/core": "^1.0.0" }),
			"packages/docs/package.json": manifest("@x/docs"),
		});
		for (const name of ["core", "cli", "docs"]) {
			await git(repo.cwd, "tag", `@x/${name}@1.0.0`);
		}
		await repo.commit("feat(core): add a thing", {
			"packages/core/thing.txt": "thing",
		});
		await repo.commit("fix: outside every package", { "root.txt": "root" });
		await git(repo.cwd, "push", "-q", "origin", "main");
	});

	const release = (dryRun = false) =>
		defineRelease({
			components: npmWorkspaces(),
			steps: [
				fsWriteVersion({ format: "npm" }),
				fsWriteChanges(),
				gitCommit(),
				...conventional({ "github/create-release": false }),
				componentsDependents(),
			],
		}).run({ cwd: repo.cwd, dryRun, reporter: null });

	it("releases each changed package and its dependents, together", async () => {
		const report = await release();
		expect(
			report.components.map((c) => [c.name, c.status, c.kind, c.version]),
		).toEqual([
			["@x/core", "released", "feature", "1.1.0"],
			["@x/docs", "unchanged", "none", undefined],
			["@x/cli", "released", "fix", "1.0.1"],
		]);
		expect(
			report.records
				.filter((r) => ["prepare", "commit", "release"].includes(r.type))
				.map((r) => `${r.component ?? "*"} ${r.name}: ${r.reason}`),
		).toEqual([
			"* fs/write-version: wrote 1.1.0 to packages/core/package.json and 1.0.1 to packages/cli/package.json (and @x/core@^1.1.0)",
			"@x/core fs/write-changes: created packages/core/CHANGELOG.md",
			"@x/cli fs/write-changes: created packages/cli/CHANGELOG.md",
			expect.stringMatching(/^\* git\/commit: committed [0-9a-f]{7}$/),
			expect.stringMatching(
				/^\* git\/create-tag: tagged @x\/core@1\.1\.0 and @x\/cli@1\.0\.1 at [0-9a-f]{7} and pushed to origin$/,
			),
		]);

		const head = await git(repo.cwd, "rev-parse", "HEAD");
		expect(await git(repo.cwd, "log", "-1", "--format=%s")).toBe(
			"chore(release): @x/core@1.1.0, @x/cli@1.0.1",
		);
		expect(
			(await git(repo.cwd, "show", "--name-only", "--format=", "HEAD")).split(
				"\n",
			),
		).toEqual([
			"packages/cli/CHANGELOG.md",
			"packages/cli/package.json",
			"packages/core/CHANGELOG.md",
			"packages/core/package.json",
		]);
		for (const tag of ["@x/core@1.1.0", "@x/cli@1.0.1"]) {
			expect(await git(repo.remote, "rev-parse", `${tag}^{commit}`)).toBe(head);
		}
		expect(await git(repo.remote, "rev-parse", "main")).toBe(head);
		expect(
			JSON.parse(
				await readFile(join(repo.cwd, "packages/cli/package.json"), "utf8"),
			),
		).toMatchObject({
			version: "1.0.1",
			dependencies: { "@x/core": "^1.1.0" },
		});
		expect(
			await readFile(join(repo.cwd, "packages/core/CHANGELOG.md"), "utf8"),
		).toMatch(
			/^## @x\/core@1\.1\.0 \(\d{4}-\d{2}-\d{2}\)\n\n### Features\n\n- \*\*core:\*\* add a thing\n$/,
		);

		// cli is released for its dependency, and says so.
		expect(report.components[2]?.dependencies).toEqual([
			{
				name: "@x/core",
				version: "1.1.0",
				previousVersion: "1.0.0",
				kind: "feature",
			},
		]);
		expect(
			await readFile(join(repo.cwd, "packages/cli/CHANGELOG.md"), "utf8"),
		).toMatch(
			/^## @x\/cli@1\.0\.1 \(\d{4}-\d{2}-\d{2}\)\n\n### Dependencies\n\n- @x\/core 1\.0\.0 → 1\.1\.0\n$/,
		);

		// Released, each package starts from its own new tag.
		await writeFile(join(repo.cwd, "packages/docs/guide.md"), "guide");
		await repo.commit("docs: a guide");
		const next = await release(true);
		expect(
			next.components.map((c) => [c.name, c.previousVersion, c.kind]),
		).toEqual([
			["@x/core", "1.1.0", "none"],
			["@x/docs", "1.0.0", "fix"],
			["@x/cli", "1.0.1", "none"],
		]);
	});

	it("changes nothing in a dry run", async () => {
		const before = await git(repo.cwd, "rev-parse", "HEAD");
		const report = await release(true);
		expect(report.status).toBe("released");
		expect(
			report.records.find((r) => r.name === "git/create-tag")?.reason,
		).toBe("would tag @x/core@1.1.0 and @x/cli@1.0.1 and push to origin");
		expect(await git(repo.cwd, "status", "--porcelain")).toBe("");
		expect(await git(repo.cwd, "rev-parse", "HEAD")).toBe(before);
	});
});
