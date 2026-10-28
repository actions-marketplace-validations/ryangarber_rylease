import type { KnipConfig } from "knip";

export default {
	tags: ["-lintignore"],
	workspaces: {
		".": {},
		"packages/cli": {},
	},
	ignore: ["**/dist/**"],
} satisfies KnipConfig;
