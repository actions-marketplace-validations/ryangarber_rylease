import {
	type Classified,
	classify,
	compareClassified,
} from "../../core/channels.ts";
import { defineHistory, type HistoryInput } from "../../core/history.ts";
import { assertFullHistory, git, tryGit } from "../../utils/git.ts";
import { templatePattern } from "../../utils/template.ts";
import { parseVersion } from "../../utils/version.ts";

interface Tag {
	name: string;
	version: string;
	commit: string;
	/** When it was tagged, or for a lightweight tag, committed; in seconds. */
	date: number;
	kind: Classified;
}

const FIELD = "\x1f";

/**
 * Finds the previous release by its tag: the nearest on HEAD. Of the release
 * tags merged into HEAD, only those that no other one comes after count, so
 * a `1.x` branch finds its own latest release, not `main`'s; of those, the
 * highest version in the scheme wins. When the scheme changed since, the
 * nearest release still marks where changes start, but there's no previous
 * version to bump: the release is the scheme's first.
 *
 * A stable release only counts stable releases. On a channel, its own
 * releases count too, and the nearest stable release is what's bumped.
 */
export const gitTags = defineHistory({
	name: "git/tags",
	description:
		"The nearest release tag on HEAD: the highest version among the tags no other release tag comes after. On a channel, its own releases count too.",
	create: () => ({
		name: "git/tags",
		find: async (input) => {
			const cwd = input.env.cwd;
			// Not a git repository, or one without commits: no previous release.
			if (
				(await tryGit(cwd, "rev-parse", "--verify", "--quiet", "HEAD")) ===
				undefined
			) {
				return undefined;
			}
			await assertFullHistory(cwd);
			const tags = await listTags(input, true);
			const channel = input.channel?.name;
			const counts = (tag: Tag) =>
				tag.kind.type === "stable" ||
				tag.kind.type === "foreign" ||
				tag.kind.channel === channel;
			const best = await nearest(cwd, tags.filter(counts), input);
			if (!best) return undefined;
			const at = `${best.name} at ${best.commit.slice(0, 7)}`;
			if (best.kind.type === "foreign") {
				return {
					ref: best.commit,
					tag: best.name,
					reason: `${at}, nearest on HEAD; not ${input.scheme.name}, so this release is its first`,
				};
			}
			const stable =
				best.kind.type === "stable"
					? undefined
					: await nearest(
							cwd,
							tags.filter((tag) => tag.kind.type === "stable"),
							input,
						);
			return {
				version: best.version,
				ref: best.commit,
				tag: best.name,
				reason: `${at}, nearest on HEAD${stable ? `; ${stable.version} before it` : ""}`,
				...(stable && {
					stable: {
						version: stable.version,
						ref: stable.commit,
						tag: stable.name,
					},
				}),
			};
		},
		count: async (input) => {
			const channel = input.channel?.name;
			let highest = 0;
			for (const { kind } of await listTags(input, false)) {
				if (
					kind.type !== "stable" &&
					kind.type !== "foreign" &&
					kind.channel === channel &&
					input.scheme.compare(kind.target, input.target) === 0
				) {
					highest = Math.max(highest, kind.n);
				}
			}
			return highest;
		},
		exists: async ({ env, releaseTag }) =>
			(await tryGit(
				env.cwd,
				"rev-parse",
				"--verify",
				"--quiet",
				`refs/tags/${releaseTag}`,
			)) !== undefined,
	}),
});

/** Release tags, of HEAD or of the whole repository, classified. */
async function listTags(input: HistoryInput, merged: boolean): Promise<Tag[]> {
	const pattern = templatePattern(input.tag, "version");
	const listing = await git(
		input.env.cwd,
		"for-each-ref",
		...(merged ? ["--merged=HEAD"] : []),
		`--format=%(refname:strip=2)${FIELD}%(objectname)${FIELD}%(*objectname)${FIELD}%(creatordate:unix)`,
		"refs/tags",
	);
	const tags: Tag[] = [];
	for (const line of listing.split("\n").filter(Boolean)) {
		const [name = "", object = "", peeled = "", date = "0"] = line.split(FIELD);
		const version = pattern.exec(name)?.[1];
		if (version === undefined) continue;
		const kind = classify(version, input.scheme, input.channels);
		// Neither the scheme's nor a channel's, nor any version at all.
		if (kind.type === "foreign" && parseVersion(version) === undefined) {
			continue;
		}
		tags.push({
			name,
			version,
			commit: peeled || object,
			date: Number(date),
			kind,
		});
	}
	return tags;
}

/**
 * The nearest of the tags: of those no other one comes after, the highest
 * in the scheme, or failing that, the latest of another scheme.
 */
async function nearest(
	cwd: string,
	tags: readonly Tag[],
	input: HistoryInput,
): Promise<Tag | undefined> {
	if (tags.length === 0) return undefined;
	const commits = [...new Set(tags.map((tag) => tag.commit))];
	const frontier = new Set(
		commits.length === 1
			? commits
			: (await git(cwd, "merge-base", "--independent", ...commits)).split("\n"),
	);
	const near = tags.filter((tag) => frontier.has(tag.commit));
	const ours = near.filter((tag) => tag.kind.type !== "foreign");
	return ours.length > 0
		? ours.reduce((a, b) =>
				compareClassified(b.kind, a.kind, input.scheme) > 0 ? b : a,
			)
		: near.reduce((a, b) => (b.date > a.date ? b : a));
}
