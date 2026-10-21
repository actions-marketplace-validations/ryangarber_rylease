import { defineStep } from "../../core/define.ts";
import type { ChangeWith } from "../../core/types.ts";
import { assertFullHistory, detectRepo, logSince } from "../../utils/git.ts";
import { plural } from "../../utils/text.ts";
import { parseSections } from "./classify.ts";

const COMMIT_SEPARATOR = "\x1e";
const FIELD_SEPARATOR = "\x1f";

/**
 * Collects every conventional section (`feat: ...`, `fix(x)!: ...`) in the
 * commits since the previous release, or in all history without one. Only
 * commits touching the component count; for the whole project, when the
 * working directory is a subdirectory of the repository, only those touching
 * it. Each change links to its commit when the repository is known: on
 * GitHub, or in GitLab CI, on GitLab.
 */
export const conventionalReadCommits = defineStep({
	type: "read-changes",
	name: "conventional/read-commits",
	description:
		"Collects each conventional section (`feat:`, `fix(x)!:` …) of every commit touching the component since the previous release, or in all history without one.",
	provides: ["changes.title"],
	run: async ({ env, component, previousRef }) => {
		const cwd = env.cwd;
		await assertFullHistory(cwd);
		const log = await logSince(cwd, {
			ref: previousRef,
			pathspec: component.pathspec,
			format: `%H${FIELD_SEPARATOR}%B${COMMIT_SEPARATOR}`,
		});
		const commitUrl = await commitUrlOf(cwd);
		const changes: ChangeWith<"title">[] = [];
		let commits = 0;
		for (const entry of log.split(COMMIT_SEPARATOR)) {
			const [sha, message = ""] = entry.trim().split(FIELD_SEPARATOR);
			if (!sha) continue;
			commits++;
			const short = sha.slice(0, 7);
			const link = commitUrl
				? { label: short, url: commitUrl(sha) }
				: undefined;
			for (const section of parseSections(message)) {
				changes.push({
					...section,
					reason: `commit ${short}`,
					...(link && { link }),
				});
			}
		}
		const since = previousRef
			? `since ${previousRef.slice(0, 7)}`
			: "in all history";
		return {
			changes,
			reason: `${plural(changes.length, "change")} in ${plural(commits, "commit")} ${since}`,
		};
	},
});

/** Links to commits on GitHub, or in GitLab CI on GitLab, when the repository is known. */
async function commitUrlOf(
	cwd: string,
): Promise<((sha: string) => string) | undefined> {
	const repo = await detectRepo(cwd);
	if (repo) {
		const server = process.env.GITHUB_SERVER_URL || "https://github.com";
		return (sha) => `${server}/${repo}/commit/${sha}`;
	}
	const project = process.env.CI_PROJECT_URL;
	return project ? (sha) => `${project}/-/commit/${sha}` : undefined;
}
