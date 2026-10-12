import { join } from "node:path";
import { defineStep } from "../define.ts";
import { z } from "../options.ts";
import { writePackageJsonVersion } from "../utils/package-json.ts";

/** Writes the new version to `package.json`, preserving its formatting. */
export const writePackageJson = defineStep({
	type: "release",
	name: "write-package-json",
	description:
		"Writes the new version to `package.json`, keeping its formatting.",
	options: {
		path: z
			.string()
			.default("package.json")
			.describe("Relative to the working directory."),
	},
	run: async ({ env, version, options: { path } }) => {
		if (env.dryRun) {
			return {
				output: { path, version, written: false },
				files: [path],
				reason: `would write ${version} to ${path}`,
			};
		}
		await writePackageJsonVersion(join(env.cwd, path), version);
		return {
			output: { path, version, written: true },
			files: [path],
			reason: `wrote ${version} to ${path}`,
		};
	},
});
