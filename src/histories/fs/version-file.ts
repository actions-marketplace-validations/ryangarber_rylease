import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { defineHistory } from "../../core/history.ts";
import { z } from "../../core/options.ts";
import { FORMAT_NAMES, versionFormat } from "../../steps/fs/formats.ts";
import { findVersionCommit } from "../../utils/git.ts";

/**
 * Finds the previous release in the project's version file: the version in
 * it, released at the commit that set it. For projects that kept their
 * version in a file before tagging releases, like `package.json` or a
 * `VERSION` file.
 */
export const fsVersionFile = defineHistory({
	name: "fs/version-file",
	description:
		"The version in the project's version file, in any format `fs/write-version` writes, released at the commit that set it.",
	options: {
		format: z
			.enum(FORMAT_NAMES)
			.default("plain")
			.describe("As for `fs/write-version`."),
		path: z
			.string()
			.optional()
			.describe(
				"Relative to the component's directory; defaults to the format's file.",
			),
		pattern: z
			.string()
			.optional()
			.describe("With the `pattern` format, where the version is."),
	},
	create: (options) => {
		const format = versionFormat(options.format, options.pattern);
		const path = options.path ?? format.path;
		if (path === "") throw new Error("the pattern format needs a `path`");
		return {
			name: "fs/version-file",
			find: async ({ env, component }) => {
				const dir = join(env.cwd, component.path);
				const shown = join(component.path, path).replaceAll("\\", "/");
				const version = format.read(await readFile(join(dir, path), "utf8"));
				if (version === undefined) throw new Error(`${shown} has no version`);
				const ref = await findVersionCommit(dir, path, version, format.read);
				return {
					version,
					...(ref && { ref }),
					reason: ref
						? `${version} in ${shown}, set in ${ref.slice(0, 7)}`
						: `${version} in ${shown}, not in git history`,
				};
			},
		};
	},
});
