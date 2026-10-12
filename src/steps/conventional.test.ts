import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defineRelease } from "../define.ts";
import { ReleaseError } from "../engine.ts";
import { git } from "../utils/git.ts";
import {
	conventional,
	gitCommit,
	readGitTag,
	readPackageJson,
} from "./index.ts";

let root: string;
let cwd: string;
let remote: string;

async function commit(message: string, files: Record<string, string> = {}) {
	for (const [name, content] of Object.entries(files)) {
		await writeFile(join(cwd, name), content);
	}
	await git(cwd, "add", "-A");
	await git(cwd, "commit", "--allow-empty", "-m", message);
}

const pkg = (version: string) =>
	`${JSON.stringify({ name: "demo", version }, null, 2)}\n`;

function releaseSteps() {
	return conventional({
		"github-release": { repo: "me/demo", token: "token" },
	});
}

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "rylease-"));
	cwd = join(root, "work");
	remote = join(root, "remote.git");
	await git(root, "init", "--bare", "-b", "main", remote);
	await git(root, "init", "-b", "main", cwd);
	await git(cwd, "config", "user.name", "Test");
	await git(cwd, "config", "user.email", "test@example.com");
	await git(cwd, "config", "commit.gpgsign", "false");
	await git(cwd, "config", "tag.gpgsign", "false");
	await git(cwd, "remote", "add", "origin", remote);

	await commit("chore: init", { "package.json": pkg("0.9.0") });
	await commit("feat: before the release");
	await commit("chore(release): v1.0.0", { "package.json": pkg("1.0.0") });
	await commit("feat: add a", { "a.txt": "a" });
	await commit("update readme");
	await commit(
		"Squashed (#3)\n\nfix(x)!: change b\n\nBody of b.\n\nfeat: add c\n",
		{ "b.txt": "b" },
	);
	await git(cwd, "push", "-u", "origin", "main");
});

afterEach(async () => {
	vi.unstubAllGlobals();
	await rm(root, { recursive: true, force: true });
});

describe("conventional preset", () => {
	it("releases changes since the version in package.json", async () => {
		const requests: { url: string; body: Record<string, unknown> }[] = [];
		vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
			requests.push({ url, body: JSON.parse(String(init.body)) });
			return Response.json({ id: 1, html_url: "https://example.com/r/1" });
		});

		const report = await defineRelease({ steps: releaseSteps() }).run({
			cwd,
			reporter: null,
		});

		expect(report.status).toBe("released");
		expect(report.records.map((r) => r.reason)).toEqual([
			expect.stringMatching(/^1\.0\.0 in package\.json, set in [0-9a-f]{7}$/),
			expect.stringMatching(/^no tag v1\.0\.0; kept [0-9a-f]{7}$/),
			expect.stringMatching(/^3 changes in 3 commits since [0-9a-f]{7}$/),
			expect.stringMatching(/^'fix\(x\)!' in title \(commit [0-9a-f]{7}\)$/),
			"'major' from 1.0.0",
			"major release; features: 2, fixes: 1, other: 0",
			"wrote 2.0.0 to package.json",
			"created CHANGELOG.md",
			expect.stringMatching(
				/^committed [0-9a-f]{7}, tagged v2\.0\.0 and pushed to origin$/,
			),
			"created release v2.0.0: https://example.com/r/1",
		]);

		const notes = [
			"## Features",
			"",
			"- add c",
			"- add a",
			"",
			"## Fixes",
			"",
			"- **x:** change b **(breaking)**",
		].join("\n");
		expect(report.notes).toBe(notes);
		expect(await readFile(join(cwd, "package.json"), "utf8")).toBe(
			pkg("2.0.0"),
		);
		expect(await readFile(join(cwd, "CHANGELOG.md"), "utf8")).toMatch(
			new RegExp(
				`^# v2\\.0\\.0 \\(\\d{4}-\\d{2}-\\d{2}\\)\n\n${notes.replace(/[*()]/g, "\\$&")}\n$`,
			),
		);

		const head = await git(cwd, "rev-parse", "HEAD");
		expect(await git(remote, "rev-parse", "main")).toBe(head);
		expect(await git(remote, "rev-parse", "v2.0.0^{commit}")).toBe(head);
		expect(await git(cwd, "log", "-1", "--format=%s")).toBe(
			"chore(release): v2.0.0",
		);
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
		const next = await defineRelease({ steps: releaseSteps() }).run({
			cwd,
			reporter: null,
		});
		expect(next.status).toBe("unchanged");
		expect(next.previousRef).toBe(head);
		expect(next.records.slice(1, 3).map((r) => r.reason)).toEqual([
			`tag v2.0.0 at ${head.slice(0, 7)}`,
			`0 changes in 0 commits since ${head.slice(0, 7)}`,
		]);
	});

	it("changes nothing in a dry run", async () => {
		const before = await git(cwd, "rev-parse", "HEAD");
		const report = await defineRelease({ steps: releaseSteps() }).run({
			cwd,
			dryRun: true,
			reporter: null,
		});

		expect(report.status).toBe("released");
		expect(report.records.slice(6).map((r) => r.reason)).toEqual([
			"would write 2.0.0 to package.json",
			"would create CHANGELOG.md",
			"would commit package.json, CHANGELOG.md, tag v2.0.0 and push to origin",
			"would create release v2.0.0 on me/demo",
		]);
		expect(await git(cwd, "status", "--porcelain")).toBe("");
		expect(await git(cwd, "rev-parse", "HEAD")).toBe(before);
		expect(await git(cwd, "tag")).toBe("");
	});

	it("refuses shallow clones", async () => {
		const shallow = join(root, "shallow");
		await git(root, "clone", "--depth", "1", `file://${remote}`, shallow);
		const error = await defineRelease({ steps: releaseSteps() })
			.run({ cwd: shallow, reporter: null })
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ReleaseError);
		expect((error as ReleaseError).message).toMatch(/shallow clone/);
	});

	it("commits only the files earlier steps reported", async () => {
		await writeFile(join(cwd, "a.txt"), "changed");
		await writeFile(join(cwd, "extra.txt"), "extra");
		const report = await defineRelease({
			steps: [
				...releaseSteps().slice(0, 6),
				{
					type: "release",
					name: "touch",
					run: async () => {
						await writeFile(join(cwd, "b.txt"), "touched");
						return { output: null, files: ["b.txt"], reason: "touched b" };
					},
				},
				gitCommit({ files: ["extra.txt"], tag: false, push: false }),
			],
		}).run({ cwd, reporter: null });
		expect(report.records.at(-1)?.reason).toMatch(/^committed [0-9a-f]{7}$/);
		expect(await git(cwd, "show", "--name-only", "--format=", "HEAD")).toBe(
			"b.txt\nextra.txt",
		);
		expect(await git(cwd, "status", "--porcelain")).toBe("M a.txt");
	});
});

describe("previous-version steps", () => {
	const versionOf = async (
		steps: Parameters<typeof defineRelease>[0]["steps"],
	) =>
		defineRelease({
			steps: [...steps, ...releaseSteps().slice(2, 6)],
		}).run({ cwd, reporter: null, dryRun: true });

	it("read the latest tag on their own", async () => {
		await git(cwd, "tag", "v1.0.0", "HEAD~3");
		await git(cwd, "tag", "v1.0.0-rc.1", "HEAD~1");
		await git(cwd, "tag", "unrelated", "HEAD");
		const tagged = await git(cwd, "rev-parse", "HEAD~3");
		const report = await versionOf([readGitTag()]);
		expect(report).toMatchObject({
			previousVersion: "1.0.0",
			previousRef: tagged,
		});
		expect(report.records[0]?.reason).toBe(
			`latest tag v1.0.0 at ${tagged.slice(0, 7)}`,
		);
		await expect(
			versionOf([readGitTag({ tag: "release-{version}" })]),
		).rejects.toThrow("no tag matches 'release-{version}'");
	});

	it("work outside git history, falling back to all commits", async () => {
		await writeFile(join(cwd, "package.json"), pkg("5.0.0"));
		const report = await versionOf([readPackageJson()]);
		expect(report.previousRef).toBeUndefined();
		expect(report.records.map((r) => r.reason).slice(0, 2)).toEqual([
			"5.0.0 in package.json, not in git history",
			"6 changes in 6 commits in all history",
		]);
	});
});
