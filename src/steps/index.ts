import { type AnyStepFactory, definePreset, type Preset } from "../define.ts";
import { conventionalCommits } from "./conventional-commits.ts";
import { conventionalKind } from "./conventional-kind.ts";
import { conventionalNotes } from "./conventional-notes.ts";
import { gitCommit } from "./git-commit.ts";
import { githubRelease } from "./github-release.ts";
import { prependChangelog } from "./prepend-changelog.ts";
import { readGitTag } from "./read-git-tag.ts";
import { readPackageJson } from "./read-package-json.ts";
import { semver } from "./semver.ts";
import { writePackageJson } from "./write-package-json.ts";

export * from "./conventional-commits.ts";
export * from "./conventional-kind.ts";
export * from "./conventional-notes.ts";
export * from "./git-commit.ts";
export * from "./github-release.ts";
export * from "./prepend-changelog.ts";
export * from "./read-git-tag.ts";
export * from "./read-package-json.ts";
export * from "./semver.ts";
export * from "./write-package-json.ts";

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

/** Every bundled step and preset, by name. */
export const builtins: ReadonlyMap<string, AnyStepFactory | Preset> = new Map<
	string,
	AnyStepFactory | Preset
>([...conventional.steps, conventional].map((item) => [item.name, item]));
