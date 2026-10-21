import { readFile, writeFile } from "node:fs/promises";
import { defineStep } from "../../core/define.ts";
import { z } from "../../core/options.ts";
import { inComponent } from "../../utils/files.ts";
import { fill, VERSION_PLACEHOLDERS } from "../../utils/template.ts";
import { channelsOption, skipOnChannel } from "../channels.ts";

/** Writes release notes to a file, creating it if needed. */
export const fsWriteChanges = defineStep({
	type: "prepare",
	name: "fs/write-changes",
	description: "Writes a heading and the notes to a file.",
	options: {
		path: z
			.string()
			.default("CHANGELOG.md")
			.describe("Relative to the component's directory."),
		heading: z
			.string()
			.default("## {tag} ({date})")
			.describe(`${VERSION_PLACEHOLDERS}, and \`{date}\` (YYYY-MM-DD).`),
		mode: z.enum(["prepend", "append", "replace"]).default("prepend"),
		channels: channelsOption,
	},
	run: async ({ env, component, placeholders, notes, options }) => {
		const { heading, mode } = options;
		const { file, relative: path } = inComponent(env, component, options.path);
		const skipped = skipOnChannel(env, options.channels, path);
		if (skipped) return skipped;
		const existing = await readFile(file, "utf8").catch((error: unknown) => {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
			throw error;
		});
		const date = new Date().toISOString().slice(0, 10);
		const entry =
			`${fill(heading, { ...placeholders, date })}\n\n${notes}`.trimEnd();
		const action = existing === undefined ? "create" : mode;
		if (env.dryRun) {
			return {
				output: { path, entry, written: false },
				files: [path],
				reason: `would ${action} ${path}`,
			};
		}
		let content = [entry];
		if (mode !== "replace") {
			content = [
				...(mode === "prepend" ? [entry] : []),
				...(existing?.trim() ? [existing.trim()] : []),
				...(mode === "append" ? [entry] : []),
			];
		}
		await writeFile(file, `${content.join("\n\n")}\n`);
		return {
			output: { path, entry, written: true },
			files: [path],
			reason: `${existing === undefined ? "created" : `${mode}${mode.endsWith("e") ? "d" : "ed"}`} ${path}`,
		};
	},
});
