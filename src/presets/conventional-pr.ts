import { definePreset } from "../core/define.ts";
import { githubReleasePr } from "../histories/index.ts";
import { semver } from "../schemes/index.ts";
import {
	conventionalBuildNotes,
	conventionalDetermineKind,
	conventionalReadCommits,
	fsWriteChanges,
	gitCreateTag,
	githubCreateRelease,
	githubOpenReleasePr,
} from "../steps/index.ts";

/**
 * Conventional commits → the changelog written and proposed in a release
 * pull request, kept up to date with each push; merging it tags the release
 * and creates its GitHub release. Versioned by semver; its history,
 * `github/release-pr`, is how the run on the merge finds what the pull
 * request proposed.
 */
export const conventionalPr = definePreset({
	name: "conventional-pr",
	description:
		"Conventional commits → changelog proposed in a release pull request; merging it tags the release and creates its GitHub release.",
	steps: [
		conventionalReadCommits,
		conventionalDetermineKind,
		conventionalBuildNotes,
		fsWriteChanges,
		githubOpenReleasePr,
		gitCreateTag,
		githubCreateRelease,
	],
	defaults: { "git/create-tag": { push: "origin" } },
	scheme: semver,
	history: githubReleasePr,
});
