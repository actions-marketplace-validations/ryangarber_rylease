import { defineStep } from "../../core/define.ts";
import { z } from "../../core/options.ts";
import type { ChangeWith } from "../../core/types.ts";
import { assertFullHistory, logSince } from "../../utils/git.ts";
import { plural } from "../../utils/text.ts";
import { githubClient, githubToken } from "./api.ts";
import { releaseRepo } from "./release.ts";

interface PullRequest {
	number: number;
	title: string;
	body: string | null;
	html_url: string;
	merged_at: string | null;
	base: { ref: string };
	labels: { name: string }[];
}

/** Commits looked up at once. */
const CONCURRENCY = 8;

/**
 * Collects the pull requests merged into the branch through the commits
 * touching the component since the previous release, or in all history
 * without one, each with its labels. Commits that weren't merged through a
 * pull request aren't counted.
 */
export const githubReadPullRequests = defineStep({
	phase: "read-changes",
	name: "github/read-pull-requests",
	description:
		"Collects the pull requests merged into the branch by the commits touching the component since the previous release, with their labels. Needs a token that can read pull requests.",
	provides: ["changes.title", "changes.labels", "changes.link"],
	options: {
		repo: z
			.string()
			.optional()
			.describe(
				"`owner/repo`; defaults to `GITHUB_REPOSITORY` or the `origin` remote.",
			),
		token: z
			.string()
			.optional()
			.describe("Defaults to `GITHUB_TOKEN` or `GH_TOKEN`."),
	},
	run: async ({ env, component, previousRef, options }) => {
		const cwd = env.cwd;
		await assertFullHistory(cwd);
		const shas = (
			await logSince(cwd, {
				ref: previousRef,
				pathspec: component.pathspec,
				format: "%H",
			})
		)
			.split("\n")
			.filter(Boolean);
		const client = githubClient(
			await releaseRepo(cwd, options.repo),
			githubToken(options.token),
		);

		const found = new Map<number, PullRequest>();
		for (let i = 0; i < shas.length; i += CONCURRENCY) {
			const batch = await Promise.all(
				shas.slice(i, i + CONCURRENCY).map(async (sha) => {
					const { data } = await client.request<PullRequest[]>(
						"GET",
						`/commits/${sha}/pulls`,
					);
					return data;
				}),
			);
			for (const pull of batch.flat()) {
				if (pull.merged_at && pull.base.ref === env.branch) {
					found.set(pull.number, pull);
				}
			}
		}

		// Newest first, as commits are.
		const changes: ChangeWith<"title" | "labels" | "link">[] = [
			...found.values(),
		].map((pull) => ({
			title: pull.title,
			...(pull.body?.trim() && { description: pull.body.trim() }),
			reason: `PR #${pull.number}`,
			link: { label: `#${pull.number}`, url: pull.html_url },
			labels: pull.labels.map((label) => label.name),
		}));
		const since = previousRef
			? `since ${previousRef.slice(0, 7)}`
			: "in all history";
		return {
			changes,
			reason: `${plural(changes.length, "pull request")} in ${plural(shas.length, "commit")} ${since}`,
		};
	},
});
