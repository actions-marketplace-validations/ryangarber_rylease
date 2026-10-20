import { definePreset } from "../core/define.ts";
import { gitTags } from "../histories/index.ts";
import {
	changeFilesClean,
	changeFilesRead,
	fsWriteChanges,
	gitCommit,
	gitCreateTag,
	githubCreateRelease,
	labelsBuildNotes,
	labelsDetermineKind,
} from "../steps/index.ts";

/**
 * Change files in `.changes/` → notes by kind → the changelog written and
 * the change files deleted, committed and tagged → GitHub release. Each
 * file names the components it changes and how much, so a monorepo's
 * releases don't depend on commit messages. Add files with `rylease add`.
 * Releases are found by their tags; set the release's `scheme`.
 */
export const changeFiles = definePreset({
	name: "change-files",
	description:
		"Change files in `.changes/` → changelog written and change files deleted, committed, git tag and GitHub release.",
	steps: [
		changeFilesRead,
		labelsDetermineKind,
		labelsBuildNotes,
		changeFilesClean,
		fsWriteChanges,
		gitCommit,
		gitCreateTag,
		githubCreateRelease,
	],
	defaults: {
		"labels/determine-kind": {
			kinds: {
				breaking: "breaking",
				feature: "feature",
				fix: "fix",
				none: "none",
			},
		},
		"labels/build-notes": {
			sections: [
				{ title: "Breaking Changes", labels: ["breaking"] },
				{ title: "Features", labels: ["feature"] },
				{ title: "Fixes", labels: ["fix"] },
			],
			other: false,
			exclude: ["none"],
			descriptions: true,
		},
		"git/create-tag": { push: "origin" },
	},
	history: gitTags,
});
