import { defineStep } from "../../core/define.ts";
import { z } from "../../core/options.ts";
import { git, identity, tryGit } from "../../utils/git.ts";
import { fill } from "../../utils/template.ts";
import { joinList, plural } from "../../utils/text.ts";
import { githubClient, githubToken } from "./api.ts";
import { releaseRepo } from "./release.ts";
import {
	type Manifest,
	PENDING_LABEL,
	RELEASE_BRANCH,
	releaseBody,
} from "./release-pr.ts";

interface PullRequest {
	number: number;
	html_url: string;
}

/**
 * Proposes the release as a pull request instead of releasing it: commits
 * what earlier `prepare` steps changed to a release branch, and opens a pull
 * request for it, or updates the one that's open. The release steps wait
 * until it merges; then the `github/release-pr` history finds it, and they
 * run for what it proposed.
 */
export const githubOpenReleasePr = defineStep({
	type: "commit",
	name: "github/open-release-pr",
	scope: "all",
	description:
		"Commits the prepared release to a branch and opens a pull request for it, or updates the open one; the release waits until it merges. Use with the `github/release-pr` history. List it after other `prepare` steps, in place of `git/commit`.",
	options: {
		branch: z
			.string()
			.default(`${RELEASE_BRANCH}{branch}`)
			.describe(
				"The release branch, force-pushed; `{branch}` is the branch being released.",
			),
		title: z
			.string()
			.default("chore(release): {tags}")
			.describe(
				"The commit message and title; `{tags}` lists every release's tag.",
			),
		labels: z
			.array(z.string())
			.default([PENDING_LABEL])
			.describe(
				"Labels for the pull request; `github/release-pr` looks for the first.",
			),
		remote: z.string().default("origin").describe("Where to push the branch."),
		repo: z
			.string()
			.optional()
			.describe(
				"`owner/repo`; defaults to `GITHUB_REPOSITORY` or the `origin` remote.",
			),
		token: z
			.string()
			.optional()
			.describe(
				"Defaults to `GITHUB_TOKEN` or `GH_TOKEN`; needs `pull-requests: write`.",
			),
	},
	run: async ({ env, components, options }) => {
		const tags = components.map(({ tag }) => tag).join(", ");
		const branch = fill(options.branch, { branch: env.branch });
		const title = fill(options.title, { tags });
		const files = [
			...new Set(
				components.flatMap(({ releases }) =>
					releases.flatMap((release) => release.files),
				),
			),
		];
		const manifest: Manifest = {
			components: Object.fromEntries(
				components.map((component) => [
					component.component.name,
					{
						version: component.version,
						tag: component.tag,
						kind: component.kind,
						...(component.previousVersion !== undefined && {
							previousVersion: component.previousVersion,
						}),
						notes: component.notes,
					},
				]),
			),
		};
		const repo = await releaseRepo(env.cwd, options.repo);
		if (env.dryRun) {
			return {
				output: { branch, number: null, url: null },
				files,
				reason: `would push ${files.length > 0 ? joinList(files) : "nothing new"} to ${branch} and propose ${tags} on ${repo}`,
				defer: `released when the pull request for ${tags} merges`,
			};
		}
		const client = githubClient(repo, githubToken(options.token));
		const cwd = env.cwd;
		// Commit on a detached HEAD, push it, and leave the checkout as it was.
		const back =
			(await tryGit(cwd, "symbolic-ref", "-q", "--short", "HEAD")) ??
			(await git(cwd, "rev-parse", "HEAD"));
		await git(cwd, "checkout", "-q", "--detach");
		try {
			if (files.length > 0) await git(cwd, "add", "--all", "--", ...files);
			await git(
				cwd,
				...(await identity(cwd)),
				"commit",
				"-q",
				"--allow-empty",
				"-m",
				title,
			);
			await git(
				cwd,
				"push",
				"--force",
				options.remote,
				`HEAD:refs/heads/${branch}`,
			);
		} finally {
			await git(cwd, "checkout", "-q", "--force", back);
		}
		const owner = repo.split("/")[0];
		const { data: open } = await client.request<PullRequest[]>(
			"GET",
			`/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`,
		);
		const body = releaseBody(manifest);
		let pull: PullRequest;
		const [existing] = open;
		if (existing) {
			pull = (
				await client.request<PullRequest>(
					"PATCH",
					`/pulls/${existing.number}`,
					{
						body: { title, body },
					},
				)
			).data;
		} else {
			pull = (
				await client.request<PullRequest>("POST", "/pulls", {
					body: { title, body, head: branch, base: env.branch },
				})
			).data;
		}
		if (options.labels.length > 0) {
			await client.request("POST", `/issues/${pull.number}/labels`, {
				body: { labels: options.labels },
			});
		}
		return {
			output: { branch, number: pull.number, url: pull.html_url },
			files,
			reason: `${existing ? "updated" : "opened"} #${pull.number} for ${tags}, with ${plural(files.length, "file")}: ${pull.html_url}`,
			defer: `released when #${pull.number} merges`,
		};
	},
});
