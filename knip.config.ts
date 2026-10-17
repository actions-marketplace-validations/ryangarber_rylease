import type { KnipConfig } from "knip";

export default {
	tags: ["-lintignore"],
	workspaces: {
		".": {},
	},
	ignore: ["**/dist/**"],
} satisfies KnipConfig;
