import { defineHistory, type Found } from "../../core/history.ts";
import { z } from "../../core/options.ts";
import { githubClient, githubToken } from "../../steps/github/api.ts";
import { releaseRepo } from "../../steps/github/release.ts";
import {
	type Manifest,
	PENDING_LABEL,
	RELEASE_BRANCH,
	readManifest,
} from "../../steps/github/release-pr.ts";
import { git, tryGit } from "../../utils/git.ts";
import { gitTags } from "../git/git-tags.ts";

interface PullRequest {
	number: number;
	body: string | null;
	merged_at: string | null;
	head: { ref: string };
	labels: { name: string }[];
}

/**
 * Finds a release that a merged release pull request proposed: when HEAD is
 * its merge, the release steps run for the versions it proposed, with its
 * notes. Components it doesn't name, or whose tag exists already, are found
 * by their tags, as with `git/tags`.
 */
export const githubReleasePr = defineHistory({
	name: "github/release-pr",
	description:
		"A release proposed by a release pull request from `github/open-release-pr`, once it's merged; otherwise the nearest release tag on HEAD, as `git/tags`.",
	options: {
		label: z
			.string()
			.default(PENDING_LABEL)
			.describe("The label of release pull requests not yet released."),
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
	create: (options) => {
		const tags = gitTags();
		// Looked up once per run, for every component.
		let merged:
			| Promise<{ number: number; manifest: Manifest } | undefined>
			| undefined;
		const find = async (cwd: string) => {
			const head = await tryGit(cwd, "rev-parse", "HEAD");
			if (head === undefined) return undefined;
			const client = githubClient(
				await releaseRepo(cwd, options.repo),
				githubToken(options.token),
			);
			const { data } = await client.request<PullRequest[]>(
				"GET",
				`/commits/${head}/pulls`,
			);
			for (const pull of data) {
				const manifest = readManifest(pull.body);
				if (
					pull.merged_at &&
					pull.head.ref.startsWith(RELEASE_BRANCH) &&
					pull.labels.some((label) => label.name === options.label) &&
					manifest
				) {
					return { number: pull.number, manifest };
				}
			}
			return undefined;
		};
		return {
			name: "github/release-pr",
			find: async (input) => {
				merged ??= find(input.env.cwd);
				const pull = await merged;
				const entry = pull?.manifest.components[input.component.name];
				const released =
					entry === undefined ||
					(await tryGit(
						input.env.cwd,
						"rev-parse",
						"--verify",
						"--quiet",
						`refs/tags/${entry.tag}`,
					)) !== undefined;
				if (!pull || !entry || released) return tags.find(input);
				const head = await git(input.env.cwd, "rev-parse", "HEAD");
				const found: Found = {
					...(entry.previousVersion !== undefined && {
						version: entry.previousVersion,
					}),
					reason: `#${pull.number} merged at ${head.slice(0, 7)}`,
					pending: {
						version: entry.version,
						notes: entry.notes,
						kind: entry.kind === "none" ? "fix" : entry.kind,
						...(entry.previousVersion !== undefined && {
							previousVersion: entry.previousVersion,
						}),
						reason: `proposed in #${pull.number}`,
					},
				};
				return found;
			},
			count: (input) => tags.count?.(input) ?? Promise.resolve(0),
			exists: (input) => tags.exists?.(input) ?? Promise.resolve(false),
		};
	},
});
