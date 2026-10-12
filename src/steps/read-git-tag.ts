import { defineStep } from "../define.ts";
import { z } from "../options.ts";
import { git, tryGit } from "../utils/git.ts";
import { compareVersions, parseVersion, type SemVer } from "../utils/semver.ts";
import { fill, templatePattern } from "../utils/template.ts";

/**
 * After another `previous-version` step, points the ref at the tag of its
 * version, keeping the incoming ref when there's no such tag. On its own, takes
 * the highest version among the tags.
 */
export const readGitTag = defineStep({
	type: "previous-version",
	name: "read-git-tag",
	description:
		"Points the ref at the tag of the version read before it; on its own, reads the highest tagged version.",
	options: {
		tag: z.string().default("v{version}").describe("The tag of a version."),
	},
	run: async ({ env, previousVersion, previousRef, options }) => {
		const template = options.tag;
		if (previousVersion === undefined) {
			const latest = await latestTag(env.cwd, template);
			return {
				version: latest.version,
				ref: latest.sha,
				reason: `latest tag ${latest.tag} at ${latest.sha.slice(0, 7)}`,
			};
		}
		const tag = fill(template, { version: previousVersion });
		const sha = await tagCommit(env.cwd, tag);
		if (sha) {
			return {
				version: previousVersion,
				ref: sha,
				reason: `tag ${tag} at ${sha.slice(0, 7)}`,
			};
		}
		return {
			version: previousVersion,
			...(previousRef ? { ref: previousRef } : {}),
			reason: `no tag ${tag}; kept ${previousRef ? previousRef.slice(0, 7) : "no ref"}`,
		};
	},
});

function tagCommit(cwd: string, tag: string): Promise<string | undefined> {
	return tryGit(
		cwd,
		"rev-parse",
		"--verify",
		"--quiet",
		`refs/tags/${tag}^{commit}`,
	);
}

async function latestTag(
	cwd: string,
	template: string,
): Promise<{ tag: string; version: string; sha: string }> {
	const pattern = templatePattern(template, "version");
	let best: { tag: string; version: string; semver: SemVer } | undefined;
	for (const tag of (await git(cwd, "tag", "--list")).split("\n")) {
		const version = pattern.exec(tag)?.[1];
		if (version === undefined) continue;
		let semver: SemVer;
		try {
			semver = parseVersion(version);
		} catch {
			continue;
		}
		if (!best || compareVersions(semver, best.semver) > 0) {
			best = { tag, version, semver };
		}
	}
	if (!best) throw new Error(`no tag matches '${template}'`);
	const sha = await tagCommit(cwd, best.tag);
	if (!sha) throw new Error(`couldn't resolve tag ${best.tag}`);
	return { tag: best.tag, version: best.version, sha };
}
