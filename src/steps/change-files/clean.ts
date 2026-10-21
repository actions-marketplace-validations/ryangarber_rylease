import { rm } from "node:fs/promises";
import { join } from "node:path";
import { defineStep } from "../../core/define.ts";
import { joinList, plural } from "../../utils/text.ts";
import { channelsOption, skipOnChannel } from "../channels.ts";
import { directoryOption, kindFor, readChangeFiles } from "./files.ts";

/**
 * Deletes the change files a release consumed, those naming a component
 * that's released, and reports them for `git/commit` to commit their
 * deletion. Releases on a channel leave them for the stable release.
 */
export const changeFilesClean = defineStep({
	type: "prepare",
	name: "change-files/clean",
	scope: "all",
	description:
		"Deletes the change files of the components being released, for `git/commit` to commit; releases on a channel leave them for the stable release.",
	options: { directory: directoryOption, channels: channelsOption },
	run: async ({ env, components, options }) => {
		const skipped = skipOnChannel(env, options.channels, "the change files");
		if (skipped) return skipped;
		const only =
			components.length === 1 && components[0]?.component.path === ".";
		const released = components.map(({ component }) => component.name);
		const files = (await readChangeFiles(env.cwd, options.directory))
			.filter(({ file }) =>
				released.some((name) => kindFor(file, name, only) !== undefined),
			)
			.map(({ path }) => path);
		if (files.length === 0) {
			return { output: { deleted: [] }, reason: "no change files to delete" };
		}
		if (!env.dryRun) {
			for (const path of files) await rm(join(env.cwd, path));
		}
		return {
			output: { deleted: env.dryRun ? [] : files },
			files,
			reason: `${env.dryRun ? "would delete" : "deleted"} ${files.length > 3 ? plural(files.length, "change file") : joinList(files)}`,
		};
	},
});
