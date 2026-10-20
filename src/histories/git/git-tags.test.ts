import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveChannels } from "../../core/channels.ts";
import type { Scheme } from "../../core/scheme.ts";
import { calver } from "../../schemes/calver.ts";
import { semver } from "../../schemes/semver.ts";
import { useRepo } from "../../testing/repo.ts";
import { root } from "../../testing/step.ts";
import { git } from "../../utils/git.ts";
import { gitTags } from "./git-tags.ts";

const repo = useRepo();

const sha = (rev: string) => git(repo.cwd, "rev-parse", rev);
const short = async (rev: string) => (await sha(rev)).slice(0, 7);

const input = (
	tag = "v{version}",
	scheme: Scheme = semver(),
	cwd = repo.cwd,
	channel?: string,
) => {
	const channels = resolveChannels(
		{ next: {}, nightly: { type: "build" } },
		scheme,
	);
	return {
		env: { cwd, branch: "main", dryRun: false },
		component: root,
		scheme,
		tag,
		channel: channels.find(({ name }) => name === channel),
		channels,
	};
};

const find = (
	tag = "v{version}",
	scheme: Scheme = semver(),
	cwd = repo.cwd,
	channel?: string,
) => gitTags().find(input(tag, scheme, cwd, channel));

describe("git/tags", () => {
	it("finds the highest release among the nearest tags", async () => {
		await git(repo.cwd, "tag", "v0.9.0", "HEAD~4");
		await git(repo.cwd, "tag", "v1.0.0", "HEAD~3");
		await git(repo.cwd, "tag", "v1.0.0-rc.1", "HEAD~3");
		await git(repo.cwd, "tag", "vnext", "HEAD");
		await git(repo.cwd, "tag", "unrelated", "HEAD");
		expect(await find()).toEqual({
			version: "1.0.0",
			ref: await sha("HEAD~3"),
			tag: "v1.0.0",
			reason: `v1.0.0 at ${await short("HEAD~3")}, nearest on HEAD`,
		});
	});

	it("only sees releases on HEAD, so a maintenance branch finds its own", async () => {
		await git(repo.cwd, "tag", "v1.0.0", "HEAD~3");
		await git(repo.cwd, "checkout", "-q", "-b", "1.x", "HEAD~2");
		await repo.commit("fix: on 1.x");
		await git(repo.cwd, "tag", "v1.0.1");
		await git(repo.cwd, "checkout", "-q", "main");
		await git(repo.cwd, "tag", "v2.0.0");
		await git(repo.cwd, "checkout", "-q", "1.x");
		expect((await find())?.version).toBe("1.0.1");
		await git(repo.cwd, "checkout", "-q", "main");
		expect((await find())?.version).toBe("2.0.0");
	});

	it("ignores older releases merged in later, keeping the higher version", async () => {
		await git(repo.cwd, "tag", "v1.0.0", "HEAD~3");
		await git(repo.cwd, "checkout", "-q", "-b", "1.x", "HEAD~3");
		await repo.commit("fix: hotfix");
		await git(repo.cwd, "tag", "v1.0.1");
		await git(repo.cwd, "checkout", "-q", "main");
		await git(repo.cwd, "tag", "v2.0.0");
		await git(repo.cwd, "merge", "-q", "--no-ff", "-m", "merge 1.x", "1.x");
		// Both are nearest, as neither comes after the other; 2.0.0 is higher.
		expect(await find()).toMatchObject({
			version: "2.0.0",
			ref: await sha("HEAD^1"),
		});
		await git(repo.cwd, "tag", "v1.0.2");
		expect((await find())?.version).toBe("1.0.2");
	});

	it("marks where a new scheme starts, without a version to bump", async () => {
		await git(repo.cwd, "tag", "v1.0.0", "HEAD~3");
		await git(repo.cwd, "tag", "v1.4.0", "HEAD~1");
		const scheme = calver();
		expect(await find("v{version}", scheme)).toEqual({
			ref: await sha("HEAD~1"),
			tag: "v1.4.0",
			reason: `v1.4.0 at ${await short("HEAD~1")}, nearest on HEAD; not calver YYYY.MM.MICRO, so this release is its first`,
		});
		await git(repo.cwd, "tag", "v2026.10.0", "HEAD");
		expect((await find("v{version}", scheme))?.version).toBe("2026.10.0");
	});

	it("follows annotated tags, and other templates", async () => {
		await git(repo.cwd, "tag", "-a", "-m", "v1", "core@1.0.0", "HEAD~3");
		await git(repo.cwd, "tag", "cli@3.0.0", "HEAD");
		expect(await find("core@{version}")).toMatchObject({
			version: "1.0.0",
			ref: await sha("HEAD~3"),
		});
	});

	it("finds nothing without release tags, or outside a repository", async () => {
		await git(repo.cwd, "tag", "nightly");
		expect(await find()).toBeUndefined();
		await expect(find("latest")).rejects.toThrow(
			"'latest' has no {version} placeholder",
		);
		const outside = await mkdtemp(join(tmpdir(), "rylease-"));
		try {
			expect(await find("v{version}", semver(), outside)).toBeUndefined();
		} finally {
			await rm(outside, { recursive: true, force: true });
		}
	});

	it("leaves channel releases to their channel", async () => {
		await git(repo.cwd, "tag", "v1.4.0", "HEAD~3");
		await git(repo.cwd, "tag", "v2.0.0-next.1", "HEAD~2");
		await git(repo.cwd, "tag", "v2.0.0-next.2", "HEAD~1");
		// A stable release only counts stable releases.
		expect((await find())?.version).toBe("1.4.0");
		// On the channel, its own count too, and the stable one is what's bumped.
		expect(await find("v{version}", semver(), repo.cwd, "next")).toEqual({
			version: "2.0.0-next.2",
			ref: await sha("HEAD~1"),
			tag: "v2.0.0-next.2",
			reason: `v2.0.0-next.2 at ${await short("HEAD~1")}, nearest on HEAD; 1.4.0 before it`,
			stable: { version: "1.4.0", ref: await sha("HEAD~3"), tag: "v1.4.0" },
		});
		// Another channel's releases don't count.
		expect(
			(await find("v{version}", semver(), repo.cwd, "nightly"))?.version,
		).toBe("1.4.0");
	});

	it("counts a channel's releases of a version across every branch", async () => {
		await git(repo.cwd, "tag", "v2.0.0-next.1", "HEAD~2");
		await git(repo.cwd, "checkout", "-q", "-b", "other", "HEAD~3");
		await repo.commit("feat: elsewhere");
		await git(repo.cwd, "tag", "v2.0.0-next.4");
		await git(repo.cwd, "tag", "v2.1.0-next.7");
		await git(repo.cwd, "checkout", "-q", "main");
		const history = gitTags();
		const count = (target: string) =>
			history.count?.({
				...input("v{version}", semver(), repo.cwd, "next"),
				target,
			});
		expect(await count("2.0.0")).toBe(4);
		expect(await count("3.0.0")).toBe(0);
		expect(
			await history.exists?.({ ...input(), releaseTag: "v2.1.0-next.7" }),
		).toBe(true);
		expect(await history.exists?.({ ...input(), releaseTag: "v9.0.0" })).toBe(
			false,
		);
	});
});
