import { defineStep } from "../../core/define.ts";
import { git } from "../../utils/git.ts";
import { fill } from "../../utils/template.ts";
import { githubClient, githubToken } from "./api.ts";
import {
	ensureRelease,
	isPrerelease,
	releaseOptions,
	releaseRepo,
} from "./release.ts";

/**
 * Creates a GitHub release for the version, with the notes as its body, or
 * finds the one another job already created.
 */
export const githubCreateRelease = defineStep({
	type: "release",
	name: "github/create-release",
	description:
		"Creates a GitHub release of the tag with the notes, unless it already has one; the tag is created at HEAD if it doesn't exist. Needs a token with `contents: write`.",
	options: releaseOptions,
	run: async ({ env, tag, placeholders, notes, options }) => {
		const title = fill(options.title, placeholders);
		const repo = await releaseRepo(env.cwd, options.repo);
		if (env.dryRun) {
			return {
				output: { repo, tag, url: null },
				reason: `would create release ${tag} on ${repo}`,
			};
		}

		const client = githubClient(repo, githubToken(options.token));
		const { release, created } = await ensureRelease(client, {
			tag,
			target: await git(env.cwd, "rev-parse", "HEAD"),
			title,
			notes,
			draft: options.draft,
			prerelease: isPrerelease(options.prerelease, env),
		});
		return {
			output: { repo, tag, id: release.id, url: release.html_url },
			reason: `${created ? "created" : "found existing"} release ${tag}: ${release.html_url}`,
		};
	},
});
