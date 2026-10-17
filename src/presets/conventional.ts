import { definePreset } from "../define.ts";
import {
	conventionalCommits,
	conventionalKind,
	conventionalNotes,
	gitCommit,
	githubRelease,
	prependChangelog,
	readGitTag,
	readPackageJson,
	semver,
	writePackageJson,
} from "../steps/index.ts";

/**
 * package.json version and tag → conventional commits → semver →
 * package.json, CHANGELOG.md, git commit and tag → GitHub release.
 */
export const conventional = definePreset({
	name: "conventional",
	description:
		"Conventional commits → semver → package.json, CHANGELOG.md, git tag and GitHub release.",
	steps: [
		readPackageJson,
		readGitTag,
		conventionalCommits,
		conventionalKind,
		semver,
		conventionalNotes,
		writePackageJson,
		prependChangelog,
		gitCommit,
		githubRelease,
	],
});
