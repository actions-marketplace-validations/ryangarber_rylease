import { defineStep } from "../../core/define.ts";
import { z } from "../../core/options.ts";
import { git, identity } from "../../utils/git.ts";
import { fill } from "../../utils/template.ts";
import { releasedPlaceholders } from "./placeholders.ts";

/**
 * Commits the files that earlier `release` steps changed, for every
 * component, in one commit. Without this the version bump never lands.
 * Pushing is off by default, so `git/create-tag` can push the commit and its
 * tags together.
 */
export const gitCommit = defineStep({
	phase: "stage",
	name: "git/commit",
	scope: "all",
	description:
		"Commits the files earlier release steps changed, for every component, in one commit.",
	options: {
		files: z
			.array(z.string())
			.default([])
			.describe("More files to commit, relative to the working directory."),
		message: z
			.string()
			.default("chore(release): {tags}")
			.describe(
				"The commit message; `{tags}` is filled in with every release's tag, and with one component, its placeholders too, e.g. `{version}`.",
			),
		push: z
			.union([z.string(), z.literal(false)])
			.default(false)
			.describe(
				"The remote to push the branch to; `false` leaves it to a later step, e.g. `git/create-tag`, so the commit and tag land together.",
			),
	},
	run: async ({ env, components, options }) => {
		const remote = options.push;
		const message = fill(options.message, releasedPlaceholders(components));
		const files = [
			...new Set([
				...components.flatMap(({ releases }) =>
					releases.flatMap((release) => release.files),
				),
				...options.files,
			]),
		];
		if (files.length === 0) {
			throw new Error("no files to commit; no earlier step reported any");
		}
		const pushing = remote ? ` and push to ${remote}` : "";
		if (env.dryRun) {
			return {
				output: { commit: null, pushed: false },
				reason: `would commit ${files.join(", ")}${pushing}`,
			};
		}

		const cwd = env.cwd;
		await git(cwd, "add", "--all", "--", ...files);
		const staged = await git(cwd, "diff", "--cached", "--name-only");
		if (staged === "") throw new Error("nothing to commit");
		await git(cwd, ...(await identity(cwd)), "commit", "-m", message);
		const commit = await git(cwd, "rev-parse", "HEAD");
		if (remote) await git(cwd, "push", remote, "HEAD");
		return {
			output: { commit, pushed: remote !== false },
			reason: `committed ${commit.slice(0, 7)}${remote ? ` and pushed to ${remote}` : ""}`,
		};
	},
});
