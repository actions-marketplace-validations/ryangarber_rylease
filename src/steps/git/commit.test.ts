import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { useRepo } from "../../testing/repo.ts";
import { released, runStep } from "../../testing/step.ts";
import { git } from "../../utils/git.ts";
import { gitCommit } from "./commit.ts";

const repo = useRepo();

/** A release where an earlier step changed `b.txt`. */
const touched = released("2.0.0", {
	releases: [{ name: "touch", output: null, files: ["b.txt"] }],
});

describe("git/commit", () => {
	it("commits only the files earlier steps reported, and its own", async () => {
		await writeFile(join(repo.cwd, "a.txt"), "changed");
		await writeFile(join(repo.cwd, "b.txt"), "touched");
		await writeFile(join(repo.cwd, "extra.txt"), "extra");
		const before = await git(repo.cwd, "rev-parse", "HEAD");
		const output = await runStep(gitCommit({ files: ["extra.txt"] }), touched, {
			cwd: repo.cwd,
		});
		const head = await git(repo.cwd, "rev-parse", "HEAD");
		expect(output).toEqual({
			output: { commit: head, pushed: false },
			reason: `committed ${head.slice(0, 7)}`,
		});
		expect(await git(repo.cwd, "log", "-1", "--format=%s")).toBe(
			"chore(release): v2.0.0",
		);
		expect(
			await git(repo.cwd, "show", "--name-only", "--format=", "HEAD"),
		).toBe("b.txt\nextra.txt");
		expect(await git(repo.cwd, "status", "--porcelain")).toBe("M a.txt");
		// Pushing is left to git/create-tag by default.
		expect(await git(repo.remote, "rev-parse", "main")).toBe(before);
	});

	it("pushes the branch when asked, with a custom message", async () => {
		await writeFile(join(repo.cwd, "b.txt"), "touched");
		const output = await runStep(
			gitCommit({ push: "origin", message: "release {major}.{minor}" }),
			touched,
			{ cwd: repo.cwd },
		);
		const head = await git(repo.cwd, "rev-parse", "HEAD");
		expect(output.reason).toBe(
			`committed ${head.slice(0, 7)} and pushed to origin`,
		);
		expect(output.output).toEqual({ commit: head, pushed: true });
		expect(await git(repo.remote, "rev-parse", "main")).toBe(head);
		expect(await git(repo.cwd, "log", "-1", "--format=%s")).toBe("release 2.0");
	});

	it("needs files, and changes in them", async () => {
		await expect(
			runStep(gitCommit(), released("2.0.0"), { cwd: repo.cwd }),
		).rejects.toThrow("no files to commit; no earlier step reported any");
		await expect(
			runStep(gitCommit(), touched, { cwd: repo.cwd }),
		).rejects.toThrow("nothing to commit");
	});

	it("only says what it would commit in a dry run", async () => {
		await writeFile(join(repo.cwd, "b.txt"), "touched");
		const before = await git(repo.cwd, "rev-parse", "HEAD");
		expect(
			await runStep(gitCommit({ files: ["c.txt"], push: "origin" }), touched, {
				cwd: repo.cwd,
				dryRun: true,
			}),
		).toEqual({
			output: { commit: null, pushed: false },
			reason: "would commit b.txt, c.txt and push to origin",
		});
		expect(await git(repo.cwd, "rev-parse", "HEAD")).toBe(before);
	});
});
