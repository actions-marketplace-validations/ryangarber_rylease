import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineStep } from "../define.ts";
import { z } from "../options.ts";
import { fill } from "../utils/template.ts";

/** Prepends the release notes to `CHANGELOG.md`, creating it if needed. */
export const prependChangelog = defineStep({
	type: "release",
	name: "prepend-changelog",
	description:
		"Prepends a heading and the notes to `CHANGELOG.md`, creating it if needed.",
	options: {
		path: z
			.string()
			.default("CHANGELOG.md")
			.describe("Relative to the working directory."),
		heading: z
			.string()
			.default("# v{version} ({date})")
			.describe("`{version}` and `{date}` (YYYY-MM-DD) are filled in."),
	},
	run: async ({ env, version, notes, options: { path, heading } }) => {
		const file = join(env.cwd, path);
		const existing = await readFile(file, "utf8").catch((error: unknown) => {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
			throw error;
		});
		const date = new Date().toISOString().slice(0, 10);
		const entry = `${fill(heading, { version, date })}\n\n${notes}`.trimEnd();
		const action = existing === undefined ? "create" : "prepend to";

		if (env.dryRun) {
			return {
				output: { path, entry, written: false },
				files: [path],
				reason: `would ${action} ${path}`,
			};
		}
		await writeFile(
			file,
			existing?.trim() ? `${entry}\n\n${existing.trimStart()}` : `${entry}\n`,
		);
		return {
			output: { path, entry, written: true },
			files: [path],
			reason: `${existing === undefined ? "created" : "prepended to"} ${path}`,
		};
	},
});
