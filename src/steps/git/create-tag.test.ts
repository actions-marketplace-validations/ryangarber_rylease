import { useRepo } from "../../testing/repo.ts";
import { released, runStep } from "../../testing/step.ts";
import { git } from "../../utils/git.ts";
import { gitCreateTag } from "./create-tag.ts";

const repo = useRepo();

const tag = (
	options: Parameters<typeof gitCreateTag>[0] = {},
	dryRun = false,
	results = released("2.0.0"),
) =>
	runStep(gitCreateTag(options), results, {
		cwd: repo.cwd,
		dryRun,
	});

describe("git/create-tag", () => {
	it("tags HEAD with an annotated tag, and pushes nothing by default", async () => {
		const head = await git(repo.cwd, "rev-parse", "HEAD");
		expect(await tag()).toEqual({
			output: { tags: ["v2.0.0"], moved: [], pushed: false },
			reason: `tagged v2.0.0 at ${head.slice(0, 7)}`,
		});
		expect(await git(repo.cwd, "rev-parse", "v2.0.0^{commit}")).toBe(head);
		expect(await git(repo.cwd, "cat-file", "-t", "v2.0.0")).toBe("tag");
		expect(
			await git(
				repo.cwd,
				"tag",
				"-l",
				"--format=%(contents:subject)",
				"v2.0.0",
			),
		).toBe("chore(release): v2.0.0");
		expect(await git(repo.remote, "tag")).toBe("");
	});

	it("pushes the branch along with the tag", async () => {
		// As git/commit would have left it: committed, not pushed.
		await repo.commit("chore(release): v2.0.0");
		await tag(
			{ push: "origin", message: "{version}" },
			false,
			released("2.0.0", { tag: "release-2" }),
		);
		const head = await git(repo.cwd, "rev-parse", "HEAD");
		expect(await git(repo.remote, "rev-parse", "main")).toBe(head);
		expect(await git(repo.remote, "rev-parse", "release-2^{commit}")).toBe(
			head,
		);
		expect(
			await git(
				repo.cwd,
				"tag",
				"-l",
				"--format=%(contents:subject)",
				"release-2",
			),
		).toBe("2.0.0");
	});

	it("moves tags to the release and force-pushes them", async () => {
		const old = await git(repo.cwd, "rev-parse", "HEAD~1");
		await git(repo.cwd, "tag", "v2", old);
		await git(repo.cwd, "push", "origin", "refs/tags/v2");

		const output = await tag({
			move: ["v{major}", "v{major}.{minor}", "v{major}"],
			push: "origin",
		});

		const head = await git(repo.cwd, "rev-parse", "HEAD");
		expect(output).toEqual({
			output: { tags: ["v2.0.0"], moved: ["v2", "v2.0"], pushed: true },
			reason: `tagged v2.0.0 at ${head.slice(0, 7)}, moved v2, v2.0 and pushed to origin`,
		});
		for (const name of ["v2.0.0", "v2", "v2.0"]) {
			expect(await git(repo.cwd, "rev-parse", `${name}^{commit}`)).toBe(head);
			expect(await git(repo.remote, "rev-parse", `${name}^{commit}`)).toBe(
				head,
			);
		}
	});

	it("pushes only tags from a detached HEAD", async () => {
		await repo.commit("detached");
		await git(repo.cwd, "checkout", "-q", "--detach");
		const pushed = await git(repo.remote, "rev-parse", "main");
		await tag({ push: "origin" });
		expect(await git(repo.remote, "rev-parse", "v2.0.0^{commit}")).toBe(
			await git(repo.cwd, "rev-parse", "HEAD"),
		);
		expect(await git(repo.remote, "rev-parse", "main")).toBe(pushed);
	});

	it("refuses a tag that already exists", async () => {
		await git(repo.cwd, "tag", "v2.0.0", "HEAD~1");
		await expect(tag()).rejects.toThrow("already exists");
	});

	it("says which tags it would create and move in a dry run", async () => {
		expect(await tag({ move: ["v{major}"], push: "origin" }, true)).toEqual({
			output: { tags: ["v2.0.0"], moved: ["v2"], pushed: false },
			reason: "would tag v2.0.0, move v2 and push to origin",
		});
		expect((await tag({}, true)).reason).toBe("would tag v2.0.0");
		expect(await git(repo.cwd, "tag")).toBe("");
	});

	it("rejects unknown placeholders", async () => {
		await expect(tag({ move: ["v{build}"] }, true)).rejects.toThrow(
			"unknown placeholder {build} in 'v{build}'; use {version} or {major} or {minor} or {patch} or {tag} or {name}",
		);
	});

	it("tags every component's release, in one push", async () => {
		const component = (name: string) => ({
			name,
			path: `packages/${name}`,
			dependsOn: [],
			pathspec: [],
		});
		const output = await runStep(
			gitCreateTag({ push: "origin" }),
			[
				released("1.1.0", { component: component("core"), tag: "core@1.1.0" }),
				released("3.0.0", { component: component("cli"), tag: "cli@3.0.0" }),
			],
			{ cwd: repo.cwd },
		);
		const head = await git(repo.cwd, "rev-parse", "HEAD");
		expect(output).toEqual({
			output: { tags: ["core@1.1.0", "cli@3.0.0"], moved: [], pushed: true },
			reason: `tagged core@1.1.0 and cli@3.0.0 at ${head.slice(0, 7)} and pushed to origin`,
		});
		for (const name of ["core@1.1.0", "cli@3.0.0"]) {
			expect(await git(repo.remote, "rev-parse", `${name}^{commit}`)).toBe(
				head,
			);
		}
	});
});
