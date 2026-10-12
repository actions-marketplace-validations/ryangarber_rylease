import { defineStep } from "../define.ts";
import { z } from "../options.ts";
import { git, tryGit } from "../utils/git.ts";
import { fill } from "../utils/template.ts";
import { joinList } from "../utils/text.ts";

const BOT_IDENTITY = [
	"-c",
	"user.name=github-actions[bot]",
	"-c",
	"user.email=41898282+github-actions[bot]@users.noreply.github.com",
];

/**
 * Commits the files that earlier `release` steps changed, tags the commit and
 * pushes both. Without this the version bump never lands, and the next run
 * would release the same changes.
 */
export const gitCommit = defineStep({
	type: "release",
	name: "git-commit",
	description:
		"Commits the files earlier release steps changed, tags the commit and pushes both.",
	options: {
		files: z
			.array(z.string())
			.default([])
			.describe("More files to commit, relative to the working directory."),
		message: z
			.string()
			.default("chore(release): v{version}")
			.describe("The commit and tag message; `{version}` is filled in."),
		tag: z
			.union([z.string(), z.literal(false)])
			.default("v{version}")
			.describe("The tag; `false` skips tagging."),
		push: z
			.union([z.string(), z.literal(false)])
			.default("origin")
			.describe("The remote to push to; `false` skips pushing."),
	},
	run: async ({ env, version, releases, options }) => {
		const remote = options.push;
		const message = fill(options.message, { version });
		const files = [
			...new Set([
				...releases.flatMap((release) => release.files),
				...options.files,
			]),
		];
		if (files.length === 0) {
			throw new Error("no files to commit; no earlier step reported any");
		}
		const tag =
			options.tag === false ? undefined : fill(options.tag, { version });
		const plan = [
			`commit ${files.join(", ")}`,
			...(tag ? [`tag ${tag}`] : []),
			...(remote ? [`push to ${remote}`] : []),
		];
		if (env.dryRun) {
			return {
				output: { commit: null, tag: tag ?? null, pushed: false },
				reason: `would ${joinList(plan)}`,
			};
		}

		const cwd = env.cwd;
		// In GitHub Actions, fall back to the bot identity when none is set.
		const identity =
			process.env.GITHUB_ACTIONS === "true" &&
			!(await tryGit(cwd, "config", "user.email"))
				? BOT_IDENTITY
				: [];

		await git(cwd, "add", "--all", "--", ...files);
		const staged = await git(cwd, "diff", "--cached", "--name-only");
		if (staged === "") throw new Error("nothing to commit");
		await git(cwd, ...identity, "commit", "-m", message);
		const commit = await git(cwd, "rev-parse", "HEAD");

		if (tag) {
			await git(cwd, ...identity, "tag", "-a", tag, "-m", message);
		}
		if (remote) {
			await git(
				cwd,
				"push",
				"--atomic",
				remote,
				"HEAD",
				...(tag ? [`refs/tags/${tag}`] : []),
			);
		}
		return {
			output: { commit, tag: tag ?? null, pushed: remote !== false },
			reason: joinList([
				`committed ${commit.slice(0, 7)}`,
				...(tag ? [`tagged ${tag}`] : []),
				...(remote ? [`pushed to ${remote}`] : []),
			]),
		};
	},
});
