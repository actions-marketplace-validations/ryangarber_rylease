import { readFile, writeFile } from "node:fs/promises";
import { defineStep } from "../../core/define.ts";
import { z } from "../../core/options.ts";
import { inComponent } from "../../utils/files.ts";
import { fill, VERSION_PLACEHOLDERS } from "../../utils/template.ts";
import { channelsOption, skipOnChannel } from "../channels.ts";
import { findUnreleased } from "./changelog.ts";

/** A `[unreleased]: <base>/compare/<tag>...HEAD` link definition. */
const UNRELEASED_LINK =
	/^\[unreleased\]:\s*(\S+)\/compare\/(\S+?)\.\.\.HEAD\s*$/i;

/**
 * Releases the `## [Unreleased]` section of a Keep a Changelog file: its
 * entries move under a heading for the version, and an empty
 * `## [Unreleased]` takes its place. A `[unreleased]: …/compare/v1.0.0...HEAD`
 * link moves on to the new tag, and the version gets its own compare link.
 */
export const keepAChangelogWriteRelease = defineStep({
	phase: "write",
	name: "keep-a-changelog/write-release",
	description:
		"Moves the entries under `## [Unreleased]` to a heading for the version, and updates the compare links, if there are any.",
	options: {
		path: z
			.string()
			.default("CHANGELOG.md")
			.describe("Relative to the component's directory."),
		heading: z
			.string()
			.default("## [{version}] - {date}")
			.describe(`${VERSION_PLACEHOLDERS}, and \`{date}\` (YYYY-MM-DD).`),
		channels: channelsOption,
	},
	run: async ({ env, component, version, tag, placeholders, options }) => {
		const { file, relative: path } = inComponent(env, component, options.path);
		const skipped = skipOnChannel(env, options.channels, path);
		if (skipped) return skipped;
		const text = await readFile(file, "utf8");
		const lines = text.split(/\r?\n/);
		const { start } = findUnreleased(lines, path);
		const date = new Date().toISOString().slice(0, 10);
		const heading = fill(options.heading, { ...placeholders, date });
		lines.splice(start + 1, 0, "", heading);

		const link = lines.findIndex((line) => UNRELEASED_LINK.test(line));
		const [, base, previous] = UNRELEASED_LINK.exec(lines[link] ?? "") ?? [];
		if (base !== undefined && previous !== undefined) {
			lines.splice(
				link,
				1,
				`[unreleased]: ${base}/compare/${tag}...HEAD`,
				`[${version}]: ${base}/compare/${previous}...${tag}`,
			);
		}

		const updated = `${heading}${base ? " and its compare link" : ""}`;
		if (env.dryRun) {
			return {
				output: { path, heading, written: false },
				files: [path],
				reason: `would add ${updated} to ${path}`,
			};
		}
		await writeFile(file, lines.join(text.includes("\r\n") ? "\r\n" : "\n"));
		return {
			output: { path, heading, written: true },
			files: [path],
			reason: `added ${updated} to ${path}`,
		};
	},
});
