import { definePreset } from "../core/define.ts";
import { gitTags } from "../histories/index.ts";
import { semver } from "../schemes/index.ts";
import {
	conventionalBuildNotes,
	conventionalDetermineKind,
	conventionalReadCommits,
	gitCreateTag,
	githubCreateRelease,
} from "../steps/index.ts";

/**
 * Conventional commits since the previous release → git tag → GitHub
 * release, versioned by semver and found by its tags. Nothing specific to a
 * language or ecosystem; add steps like `fs/write-version`,
 * `fs/write-changes` and `git/commit` for that. The tag is pushed, with the
 * branch, to `origin`.
 */
export const conventional = definePreset({
	name: "conventional",
	description: "Conventional commits → notes → git tag and GitHub release.",
	steps: [
		conventionalReadCommits,
		conventionalDetermineKind,
		conventionalBuildNotes,
		gitCreateTag,
		githubCreateRelease,
	],
	defaults: { "git/create-tag": { push: "origin" } },
	scheme: semver,
	history: gitTags,
});
