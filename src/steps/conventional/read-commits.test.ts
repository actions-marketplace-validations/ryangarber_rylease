import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { useRepo } from "../../testing/repo.ts";
import { runStep } from "../../testing/step.ts";
import { git } from "../../utils/git.ts";
import { conventionalReadCommits } from "./read-commits.ts";

const repo = useRepo();

const read = (previousRef?: string, cwd = repo.cwd) =>
	runStep(
		conventionalReadCommits(),
		{ previousVersion: "1.0.0", ...(previousRef && { previousRef }) },
		{ cwd },
	);

describe("conventional/read-commits", () => {
	it("collects every section of the commits since the ref", async () => {
		const ref = await git(repo.cwd, "rev-parse", "HEAD~3");
		const squashed = (await git(repo.cwd, "rev-parse", "HEAD")).slice(0, 7);
		const first = (await git(repo.cwd, "rev-parse", "HEAD~2")).slice(0, 7);
		expect(await read(ref)).toEqual({
			changes: [
				{
					title: "fix(x)!: change b",
					description: "Body of b.",
					reason: `commit ${squashed}`,
				},
				{ title: "feat: add c", reason: `commit ${squashed}` },
				{ title: "feat: add a", reason: `commit ${first}` },
			],
			reason: `3 changes in 3 commits since ${ref.slice(0, 7)}`,
		});
	});

	it("collects all history without a ref", async () => {
		expect((await read()).reason).toBe("6 changes in 6 commits in all history");
		const head = await git(repo.cwd, "rev-parse", "HEAD");
		expect((await read(head)).reason).toBe(
			`0 changes in 0 commits since ${head.slice(0, 7)}`,
		);
	});

	it("links each change to its commit on GitHub", async () => {
		vi.stubEnv("GITHUB_REPOSITORY", "me/demo");
		vi.stubEnv("GITHUB_SERVER_URL", "https://git.example.com");
		const head = await git(repo.cwd, "rev-parse", "HEAD");
		const { changes } = await read(await git(repo.cwd, "rev-parse", "HEAD~1"));
		expect(changes.map((change) => change.link)).toEqual([
			{
				label: head.slice(0, 7),
				url: `https://git.example.com/me/demo/commit/${head}`,
			},
			{
				label: head.slice(0, 7),
				url: `https://git.example.com/me/demo/commit/${head}`,
			},
		]);
	});

	it("links each change to its commit on GitLab, in GitLab CI", async () => {
		vi.stubEnv("CI_PROJECT_URL", "https://gitlab.example.com/g/p");
		const head = await git(repo.cwd, "rev-parse", "HEAD");
		const { changes } = await read(await git(repo.cwd, "rev-parse", "HEAD~1"));
		expect(changes[0]?.link).toEqual({
			label: head.slice(0, 7),
			url: `https://gitlab.example.com/g/p/-/commit/${head}`,
		});
	});

	it("in a subdirectory, only reads commits touching it", async () => {
		await mkdir(join(repo.cwd, "pkg"));
		await repo.commit("feat(pkg): add pkg", { "pkg/x.txt": "x" });
		await repo.commit("fix: outside pkg", { "a.txt": "changed" });
		const { changes, reason } = await read(undefined, join(repo.cwd, "pkg"));
		expect(changes.map((change) => change.title)).toEqual([
			"feat(pkg): add pkg",
		]);
		expect(reason).toBe("1 change in 1 commit in all history");
	});

	it("refuses shallow clones", async () => {
		const shallow = join(repo.root, "shallow");
		await git(
			repo.root,
			"clone",
			"--depth",
			"1",
			`file://${repo.remote}`,
			shallow,
		);
		await expect(read(undefined, shallow)).rejects.toThrow(/shallow clone/);
	});
});
