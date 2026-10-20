import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { semver } from "../../schemes/semver.ts";
import { pkg, useRepo } from "../../testing/repo.ts";
import { root } from "../../testing/step.ts";
import { git } from "../../utils/git.ts";
import { fsVersionFile } from "./version-file.ts";

const repo = useRepo();

const env = (cwd = repo.cwd) => ({ cwd, branch: "main", dryRun: false });

const read = (
	options: Parameters<typeof fsVersionFile>[0] = {},
	cwd = repo.cwd,
	component = root,
) =>
	fsVersionFile(options).find({
		env: env(cwd),
		component,
		scheme: semver(),
		tag: "v{version}",
		channels: [],
	});

describe("fs/version-file", () => {
	it("finds the version in a file that holds only it", async () => {
		await repo.commit("chore: version", { VERSION: "2.3.4\n" });
		const set = await git(repo.cwd, "rev-parse", "HEAD");
		await repo.commit("chore: later");
		expect(await read()).toEqual({
			version: "2.3.4",
			ref: set,
			reason: `2.3.4 in VERSION, set in ${set.slice(0, 7)}`,
		});
	});
});

describe("fs/version-file, with the npm format", () => {
	const npm = (cwd = repo.cwd, component = root) =>
		read({ format: "npm" }, cwd, component);

	it("finds the version, released at the commit that set it", async () => {
		const set = await git(repo.cwd, "rev-parse", "HEAD~3");
		expect(await npm()).toEqual({
			version: "1.0.0",
			ref: set,
			reason: `1.0.0 in package.json, set in ${set.slice(0, 7)}`,
		});
	});

	it("skips later commits that kept the version", async () => {
		const set = await git(repo.cwd, "rev-parse", "HEAD~3");
		await repo.commit("chore: describe", {
			"package.json": JSON.stringify({ name: "demo", version: "1.0.0", x: 1 }),
		});
		expect((await npm())?.ref).toBe(set);
	});

	it("reads the component's package.json", async () => {
		await mkdir(join(repo.cwd, "packages", "a"), { recursive: true });
		await repo.commit("feat: package a", {
			"packages/a/package.json": pkg("3.1.0"),
		});
		const set = await git(repo.cwd, "rev-parse", "HEAD");
		expect(
			await npm(repo.cwd, { ...root, name: "a", path: "packages/a" }),
		).toEqual({
			version: "3.1.0",
			ref: set,
			reason: `3.1.0 in packages/a/package.json, set in ${set.slice(0, 7)}`,
		});
	});

	it("has no ref for a version that isn't in git history", async () => {
		await writeFile(join(repo.cwd, "package.json"), pkg("5.0.0"));
		expect(await npm()).toEqual({
			version: "5.0.0",
			reason: "5.0.0 in package.json, not in git history",
		});
		const outside = await mkdtemp(join(tmpdir(), "rylease-"));
		try {
			await writeFile(join(outside, "package.json"), pkg("1.2.3"));
			expect(await npm(outside)).toEqual({
				version: "1.2.3",
				reason: "1.2.3 in package.json, not in git history",
			});
		} finally {
			await rm(outside, { recursive: true, force: true });
		}
	});

	it("needs a version", async () => {
		await writeFile(join(repo.cwd, "package.json"), '{ "name": "demo" }');
		await expect(npm()).rejects.toThrow("package.json has no version");
		await expect(read({ format: "npm", path: "missing.json" })).rejects.toThrow(
			"ENOENT",
		);
	});
});
