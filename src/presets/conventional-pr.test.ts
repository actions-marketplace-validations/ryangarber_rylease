import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { defineRelease } from "../core/define.ts";
import { githubReleasePr } from "../histories/index.ts";
import { fsWriteVersion } from "../steps/index.ts";
import { github, useFakeGitHub } from "../testing/github.ts";
import { pkg, useRepo } from "../testing/repo.ts";
import { git } from "../utils/git.ts";
import { conventionalPr } from "./conventional-pr.ts";

const repo = useRepo();
useFakeGitHub();

const release = (dryRun = false) =>
	defineRelease({
		history: githubReleasePr(),
		steps: [...conventionalPr(), fsWriteVersion({ format: "npm" })],
	}).run({ cwd: repo.cwd, dryRun, branch: "main", reporter: null });

/** Merges the release branch into main on the remote's behalf, as GitHub would. */
async function merge(number: number) {
	await git(repo.cwd, "fetch", "-q", "origin");
	await git(
		repo.cwd,
		"merge",
		"-q",
		"--no-ff",
		"-m",
		`Merge #${number}`,
		"origin/rylease/main",
	);
	await git(repo.cwd, "push", "-q", "origin", "main");
	const pull = github.pulls.find((p) => p.number === number);
	if (pull) {
		Object.assign(pull, {
			state: "closed",
			merged_at: new Date().toISOString(),
			merge_commit_sha: await git(repo.cwd, "rev-parse", "HEAD"),
		});
	}
}

describe("conventional-pr", () => {
	it("proposes the release, then releases it once merged", async () => {
		await git(repo.cwd, "tag", "v1.0.0", "HEAD~3");
		await git(repo.cwd, "push", "-q", "origin", "v1.0.0");
		const head = await git(repo.cwd, "rev-parse", "HEAD");

		const proposed = await release();
		expect(proposed.status).toBe("pending");
		expect(
			proposed.records.slice(-2).map((r) => `${r.name}: ${r.status}`),
		).toEqual(["git/create-tag: skipped", "github/create-release: skipped"]);
		// Nothing changed here; the release is on its branch.
		expect(await git(repo.cwd, "rev-parse", "HEAD")).toBe(head);
		expect(await git(repo.cwd, "status", "--porcelain")).toBe("");
		expect(await git(repo.remote, "tag")).toBe("v1.0.0");
		const branch = await git(repo.remote, "show", "rylease/main:package.json");
		expect(branch).toBe(pkg("2.0.0").trimEnd());
		expect(github.pulls).toMatchObject([
			{
				number: 1,
				title: "chore(release): v2.0.0",
				head: { ref: "rylease/main" },
				base: { ref: "main" },
				labels: [{ name: "rylease: pending" }],
				body: expect.stringContaining("## v2.0.0\n\n### Breaking Changes"),
			},
		]);

		// Another push updates the same pull request.
		await repo.commit("fix: one more");
		await git(repo.cwd, "push", "-q", "origin", "main");
		const updated = await release();
		expect(
			updated.records.find((r) => r.name === "github/open-release-pr")?.reason,
		).toMatch(/^updated #1 for v2\.0\.0, with 2 files: /);
		expect(github.pulls).toHaveLength(1);
		expect(github.pulls[0]?.body).toContain("- one more");

		// Merged, it's released as proposed: only the release steps run.
		await merge(1);
		const released = await release();
		expect(released.status).toBe("released");
		expect(released.version).toBe("2.0.0");
		expect(released.records[0]?.reason).toMatch(/^#1 merged at [0-9a-f]{7}$/);
		expect(
			released.records.filter((r) => r.status === "ok").map((r) => r.name),
		).toEqual(["github/release-pr", "git/create-tag", "github/create-release"]);
		expect(await git(repo.remote, "rev-parse", "v2.0.0^{commit}")).toBe(
			await git(repo.cwd, "rev-parse", "HEAD"),
		);
		expect(github.releases).toMatchObject([
			{ tag_name: "v2.0.0", body: expect.stringContaining("- one more") },
		]);
		expect(
			JSON.parse(await readFile(join(repo.cwd, "package.json"), "utf8"))
				.version,
		).toBe("2.0.0");

		// Run again, it finds the tag: nothing left to release.
		expect((await release()).status).toBe("unchanged");
	});

	it("only says what it would propose in a dry run", async () => {
		const report = await release(true);
		expect(report.status).toBe("pending");
		expect(
			report.records.find((r) => r.name === "github/open-release-pr")?.reason,
		).toBe(
			"would push CHANGELOG.md and package.json to rylease/main and propose v0.1.0 on me/demo",
		);
		expect(github.pulls).toEqual([]);
		await expect(
			git(repo.remote, "rev-parse", "--verify", "rylease/main"),
		).rejects.toThrow();
	});
});
