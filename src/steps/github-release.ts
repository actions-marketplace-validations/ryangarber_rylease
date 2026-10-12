import { defineStep } from "../define.ts";
import { z } from "../options.ts";
import { git } from "../utils/git.ts";
import { detectRepo } from "../utils/github.ts";
import { fill } from "../utils/template.ts";

/** Creates a GitHub release for the version, with the notes as its body. */
export const githubRelease = defineStep({
	type: "release",
	name: "github-release",
	description:
		"Creates a GitHub release with the notes. Needs a token with `contents: write`.",
	options: {
		tag: z
			.string()
			.default("v{version}")
			.describe("The release's tag; created at HEAD if it doesn't exist."),
		title: z
			.string()
			.optional()
			.describe("`{version}` is filled in; defaults to the tag."),
		draft: z.boolean().default(false),
		prerelease: z.boolean().default(false),
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
	run: async ({ env, version, notes, options }) => {
		const tag = fill(options.tag, { version });
		const title =
			options.title === undefined ? tag : fill(options.title, { version });
		const repo = options.repo ?? (await detectRepo(env.cwd));
		if (!repo) {
			throw new Error(
				"couldn't determine the GitHub repository; set `repo` or GITHUB_REPOSITORY",
			);
		}
		if (env.dryRun) {
			return {
				output: { repo, tag, url: null },
				reason: `would create release ${tag} on ${repo}`,
			};
		}

		const token =
			options.token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
		if (!token) throw new Error("no token; set GITHUB_TOKEN or GH_TOKEN");
		const apiUrl = process.env.GITHUB_API_URL ?? "https://api.github.com";
		const response = await fetch(`${apiUrl}/repos/${repo}/releases`, {
			method: "POST",
			headers: {
				accept: "application/vnd.github+json",
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
				"x-github-api-version": "2022-11-28",
			},
			body: JSON.stringify({
				tag_name: tag,
				target_commitish: await git(env.cwd, "rev-parse", "HEAD"),
				name: title,
				body: notes,
				draft: options.draft,
				prerelease: options.prerelease,
			}),
		});
		if (!response.ok) {
			throw new Error(
				`GitHub responded ${response.status}: ${await response.text()}`,
			);
		}
		const release = (await response.json()) as {
			id: number;
			html_url: string;
		};
		return {
			output: { repo, tag, id: release.id, url: release.html_url },
			reason: `created release ${tag}: ${release.html_url}`,
		};
	},
});
