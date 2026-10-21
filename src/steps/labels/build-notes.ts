import { defineStep } from "../../core/define.ts";
import { z } from "../../core/options.ts";
import type { Change } from "../../core/types.ts";
import {
	dependenciesOption,
	dependencySection,
	joinSections,
} from "../notes.ts";
import { hasLabel } from "./labels.ts";

/**
 * A `### Title` section per group of labels, like GitHub's own release notes
 * categories, then the rest.
 */
export const labelsBuildNotes = defineStep({
	type: "build-notes",
	name: "labels/build-notes",
	description:
		"A `### Title` section per group of labels, e.g. `### Bug Fixes` for `bug`, then `### Other` for everything else.",
	needs: ["changes.labels"],
	options: {
		sections: z
			.array(z.strictObject({ title: z.string(), labels: z.array(z.string()) }))
			.default([
				{ title: "Breaking Changes", labels: ["breaking", "semver:major"] },
				{ title: "Features", labels: ["feature", "enhancement"] },
				{ title: "Bug Fixes", labels: ["bug", "fix"] },
			])
			.describe(
				"Sections in order; a change goes in the first with one of its labels, ignoring case.",
			),
		other: z
			.union([z.string(), z.literal(false)])
			.default("Other")
			.describe("The section for remaining changes; `false` leaves them out."),
		exclude: z
			.array(z.string())
			.default(["skip-changelog"])
			.describe("Changes with any of these labels are left out."),
		descriptions: z
			.boolean()
			.default(false)
			.describe("Write each change's description, indented, under it."),
		links: z
			.boolean()
			.default(true)
			.describe("Link each change to its source, e.g. its pull request."),
		dependencies: dependenciesOption,
	},
	run: ({ changes, kind, dependencies, options }) => {
		const sections = [
			...options.sections,
			...(options.other === false ? [] : [{ title: options.other }]),
		].map((section) => ({ ...section, entries: [] as string[] }));
		for (const change of changes) {
			if (hasLabel(change, options.exclude)) continue;
			const target = sections.find(
				(section) => !("labels" in section) || hasLabel(change, section.labels),
			);
			const entry = format(change, options);
			if (target && entry !== undefined) target.entries.push(entry);
		}
		return joinSections(kind, [
			...sections,
			...dependencySection(options.dependencies, dependencies),
		]);
	},
});

function format(
	change: Change,
	style: { descriptions: boolean; links: boolean },
): string | undefined {
	const lines = (change.title ?? change.description ?? "").trim().split("\n");
	const text = lines[0]?.trim();
	if (!text) return undefined;
	const link =
		style.links && change.link
			? ` ([${change.link.label}](${change.link.url}))`
			: "";
	// Without a title, the description's first line stands in for it.
	const body =
		change.title === undefined ? lines.slice(1) : [change.description ?? ""];
	const details = body.join("\n").trim();
	const indented =
		style.descriptions && details
			? `\n${details
					.split("\n")
					.map((line) => (line.trim() ? `  ${line}` : ""))
					.join("\n")}`
			: "";
	return `- ${text}${link}${indented}`;
}
