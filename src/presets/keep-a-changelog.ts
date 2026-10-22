import { definePreset } from "../core/define.ts";
import { gitTags } from "../histories/index.ts";
import {
	gitCommit,
	gitCreateTag,
	githubCreateRelease,
	keepAChangelogReadUnreleased,
	keepAChangelogWriteRelease,
	labelsBuildNotes,
	labelsDetermineKind,
} from "../steps/index.ts";

const SECTIONS = [
	"Added",
	"Changed",
	"Deprecated",
	"Removed",
	"Fixed",
	"Security",
];

/**
 * `## [Unreleased]` in CHANGELOG.md → the changelog released, committed and
 * tagged → GitHub release. Each entry's kind comes from its section:
 * `Removed` is breaking, `Added`, `Changed` and `Deprecated` features, and
 * the rest fixes. Releases are found by their tags; set the release's
 * `scheme`, e.g. `semver()`, or `calver()` to date them.
 */
export const keepAChangelog = definePreset({
	name: "keep-a-changelog",
	description:
		"`## [Unreleased]` in CHANGELOG.md → changelog committed, git tag and GitHub release.",
	steps: [
		keepAChangelogReadUnreleased,
		labelsDetermineKind,
		labelsBuildNotes,
		keepAChangelogWriteRelease,
		gitCommit,
		gitCreateTag,
		githubCreateRelease,
	],
	defaults: {
		"labels/determine-kind": {
			kinds: {
				Removed: "breaking",
				Added: "feature",
				Changed: "feature",
				Deprecated: "feature",
			},
		},
		"labels/determine-notes": {
			sections: SECTIONS.map((title) => ({ title, labels: [title] })),
			descriptions: true,
		},
		"git/create-tag": { push: "origin" },
	},
	history: gitTags,
});
