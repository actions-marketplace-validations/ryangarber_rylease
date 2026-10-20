import { readFile } from "node:fs/promises";
import { defineStep } from "../../core/define.ts";
import { z } from "../../core/options.ts";
import type { ChangeWith } from "../../core/types.ts";
import { inComponent } from "../../utils/files.ts";
import { plural } from "../../utils/text.ts";
import { findUnreleased } from "./changelog.ts";

/**
 * Collects the entries of the `## [Unreleased]` section of a changelog kept as
 * on keepachangelog.com: each top-level bullet is a change, labeled with its
 * `### Added`, `### Fixed` … heading, and the lines under it its description.
 */
export const keepAChangelogReadUnreleased = defineStep({
	type: "read-changes",
	name: "keep-a-changelog/read-unreleased",
	description:
		"Collects each entry under `## [Unreleased]` in a Keep a Changelog file, labeled with its `### Added`, `### Fixed` … heading.",
	provides: ["changes.title", "changes.labels"],
	options: {
		path: z
			.string()
			.default("CHANGELOG.md")
			.describe("Relative to the component's directory."),
	},
	run: async ({ env, component, options }) => {
		const { file, relative: path } = inComponent(env, component, options.path);
		const lines = (await readFile(file, "utf8")).split(/\r?\n/);
		const { start, end } = findUnreleased(lines, path);
		const changes: ChangeWith<"title" | "labels">[] = [];
		let category: string | undefined;
		let current:
			| { change: ChangeWith<"title" | "labels">; body: string[] }
			| undefined;
		const finish = () => {
			const description = current?.body.join("\n").trim();
			if (current && description) current.change.description = description;
			current = undefined;
		};
		for (let i = start + 1; i < end; i++) {
			const line = lines[i] ?? "";
			const heading = /^###\s+(.+?)\s*$/.exec(line);
			const bullet = /^[-*+]\s+(.*)$/.exec(line);
			if (heading) {
				finish();
				category = heading[1];
			} else if (bullet) {
				finish();
				current = {
					change: {
						title: (bullet[1] ?? "").trim(),
						reason: `${path} line ${i + 1}`,
						labels: category ? [category] : [],
					},
					body: [],
				};
				changes.push(current.change);
			} else if (current && (line.trim() === "" || /^\s/.test(line))) {
				// Continuation lines, indented under the bullet.
				current.body.push(line.replace(/^ {1,2}|^\t/, ""));
			} else {
				finish();
			}
		}
		finish();
		return {
			changes,
			reason: `${plural(changes.length, "entry", "entries")} under ${lines[start]?.trim()} in ${path}`,
		};
	},
});
