import { defineStep } from "../../core/define.ts";
import { z } from "../../core/options.ts";
import { git, identity, tryGit } from "../../utils/git.ts";
import { fill, VERSION_PLACEHOLDERS } from "../../utils/template.ts";
import { joinList } from "../../utils/text.ts";

/**
 * Tags HEAD with every component's release, moves any floating tags to it,
 * and pushes them along with the current branch in one atomic push, so a
 * commit from `git/commit` and its tags land together or not at all.
 */
export const gitCreateTag = defineStep({
	phase: "release",
	name: "git/create-tag",
	scope: "all",
	description:
		"Tags HEAD with each release's tag and pushes them, along with the branch, in one atomic push.",
	options: {
		message: z
			.string()
			.default("chore(release): {tag}")
			.describe(`The tag message; ${VERSION_PLACEHOLDERS}.`),
		move: z
			.array(z.string())
			.default([])
			.describe(
				"Tags to create or move to each release, e.g. `v{major}`; force-pushed. Those with `{channel}` only move on a channel, e.g. to `next`, and the others only on stable releases.",
			),
		push: z
			.union([z.string(), z.literal(false)])
			.default(false)
			.describe(
				"The remote to push the tags and the current branch to; `false` skips pushing.",
			),
	},
	run: async ({ env, components, options }) => {
		const remote = options.push;
		const tags = components.map(({ tag, placeholders }) => ({
			tag,
			message: fill(options.message, placeholders),
		}));
		const moved = [
			...new Set(
				components.flatMap(({ placeholders }) =>
					options.move
						.filter(
							(name) =>
								name.includes("{channel}") === (env.channel !== undefined),
						)
						.map((name) => fill(name, placeholders)),
				),
			),
		];
		const names = joinList(tags.map(({ tag }) => tag));
		if (env.dryRun) {
			return {
				output: { tags: tags.map(({ tag }) => tag), moved, pushed: false },
				reason: `would ${joinList([
					`tag ${names}`,
					...(moved.length ? [`move ${moved.join(", ")}`] : []),
					...(remote ? [`push to ${remote}`] : []),
				])}`,
			};
		}
		const cwd = env.cwd;
		const head = await git(cwd, "rev-parse", "HEAD");
		const who = await identity(cwd);
		for (const { tag, message } of tags) {
			await git(cwd, ...who, "tag", "-a", tag, "-m", message);
		}
		for (const name of moved) await git(cwd, "tag", "-f", name, "HEAD");
		if (remote) {
			// One atomic push, so a release lands entirely or not at all. Only the
			// moved tags are forced. A detached HEAD has no branch to push.
			const onBranch = await tryGit(cwd, "symbolic-ref", "-q", "HEAD");
			await git(
				cwd,
				"push",
				"--atomic",
				remote,
				...(onBranch ? ["HEAD"] : []),
				...tags.map(({ tag }) => `refs/tags/${tag}`),
				...moved.map((name) => `+refs/tags/${name}`),
			);
		}
		return {
			output: {
				tags: tags.map(({ tag }) => tag),
				moved,
				pushed: remote !== false,
			},
			reason: joinList([
				`tagged ${names} at ${head.slice(0, 7)}`,
				...(moved.length ? [`moved ${moved.join(", ")}`] : []),
				...(remote ? [`pushed to ${remote}`] : []),
			]),
		};
	},
});
