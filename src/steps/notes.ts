import { z } from "../core/options.ts";
import type { Dependency, ReleaseKind } from "../core/types.ts";

/** The `dependencies` option of the steps that build notes. */
export const dependenciesOption = z
	.union([z.string(), z.literal(false)])
	.default("Dependencies")
	.describe(
		"The last section, for the components it depends on that were released along with it; `false` leaves it out.",
	);

/** A section of notes, as the steps that build notes collect them. */
export interface Section {
	title: string;
	entries: string[];
}

/** A section listing released dependencies, e.g. `- core 1.2.0 → 2.0.0`. */
export function dependencySection(
	title: string | false,
	dependencies: readonly Dependency[],
): Section[] {
	if (title === false || dependencies.length === 0) return [];
	return [
		{
			title,
			entries: dependencies.map(({ name, version, previousVersion }) =>
				previousVersion === undefined
					? `- ${name} ${version}`
					: `- ${name} ${previousVersion} → ${version}`,
			),
		},
	];
}

/** Notes from the sections that have entries, and their reason. */
export function joinSections(
	kind: ReleaseKind,
	sections: readonly Section[],
): { notes: string; reason: string } {
	const filled = sections.filter(({ entries }) => entries.length > 0);
	return {
		notes: filled
			.map(({ title, entries }) => `### ${title}\n\n${entries.join("\n")}`)
			.join("\n\n"),
		reason: `${kind} release; ${
			filled
				.map(
					({ title, entries }) => `${title.toLowerCase()}: ${entries.length}`,
				)
				.join(", ") || "no entries"
		}`,
	};
}
