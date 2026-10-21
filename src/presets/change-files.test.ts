import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineRelease } from "../core/define.ts";
import { semver } from "../schemes/index.ts";
import { useRepo } from "../testing/repo.ts";
import { git } from "../utils/git.ts";
import { changeFiles } from "./change-files.ts";

const repo = useRepo();

beforeEach(async () => {
	for (const name of ["core", "cli"]) {
		await mkdir(join(repo.cwd, "packages", name), { recursive: true });
	}
	await mkdir(join(repo.cwd, ".changes"));
	await repo.commit("chore: packages", {
		"packages/core/a.txt": "a",
		"packages/cli/b.txt": "b",
	});
	await git(repo.cwd, "tag", "core@1.0.0");
	await git(repo.cwd, "tag", "cli@1.0.0");
	await repo.commit("docs: change files", {
		".changes/dark-mode.md":
			"---\ncore: feature\ncli: fix\n---\nAdd dark mode.\n\nIt follows the system's.\n",
		".changes/typo.md": "---\ncore: none\n---\nFix a typo in a comment.\n",
		".changes/README.md": "How to write change files.\n",
	});
	await git(repo.cwd, "push", "-q", "origin", "main");
});

const release = (dryRun = false) =>
	defineRelease({
		components: [
			{ name: "core", path: "packages/core" },
			{ name: "cli", path: "packages/cli", dependsOn: ["core"] },
		],
		steps: changeFiles({ "github/create-release": false }),
		scheme: semver(),
	}).run({ cwd: repo.cwd, dryRun, reporter: null });

describe("change-files", () => {
	it("releases what the change files say, then deletes them", async () => {
		const report = await release();
		expect(report.components.map((c) => [c.name, c.kind, c.version])).toEqual([
			["core", "feature", "1.1.0"],
			["cli", "fix", "1.0.1"],
		]);
		expect(report.components.map((c) => c.notes)).toEqual([
			"### Features\n\n- Add dark mode.\n  It follows the system's.",
			"### Fixes\n\n- Add dark mode.\n  It follows the system's.\n\n### Dependencies\n\n- core 1.0.0 → 1.1.0",
		]);
		expect(await readdir(join(repo.cwd, ".changes"))).toEqual(["README.md"]);
		expect(
			(await git(repo.cwd, "show", "--name-status", "--format=", "HEAD")).split(
				"\n",
			),
		).toEqual([
			"D\t.changes/dark-mode.md",
			"D\t.changes/typo.md",
			"A\tpackages/cli/CHANGELOG.md",
			"A\tpackages/core/CHANGELOG.md",
		]);
		expect(await git(repo.cwd, "status", "--porcelain")).toBe("");
		// Nothing left to release.
		expect((await release()).status).toBe("unchanged");
	});

	it("keeps the change files in a dry run", async () => {
		const report = await release(true);
		expect(
			report.records.find((r) => r.name === "change-files/clean")?.reason,
		).toBe("would delete .changes/dark-mode.md and .changes/typo.md");
		expect((await readdir(join(repo.cwd, ".changes"))).sort()).toEqual([
			"README.md",
			"dark-mode.md",
			"typo.md",
		]);
	});

	it("rejects change files that name no component", async () => {
		await writeFile(
			join(repo.cwd, ".changes/x.md"),
			"---\nweb: fix\n---\nX.\n",
		);
		await expect(release(true)).rejects.toThrow(
			".changes/x.md names 'web', which isn't a component; use core, cli",
		);
		await writeFile(
			join(repo.cwd, ".changes/x.md"),
			"---\ncore: huge\n---\nX.\n",
		);
		await expect(release(true)).rejects.toThrow(
			".changes/x.md line 2: 'huge' isn't a kind; use breaking, feature, fix, none",
		);
		expect(await readFile(join(repo.cwd, ".changes/x.md"), "utf8")).toContain(
			"huge",
		);
	});
});
