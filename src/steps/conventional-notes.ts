import { defineStep } from "../define.ts";
import { z } from "../options.ts";
import type { Change } from "../types.ts";
import {
	mentionsBreaking,
	parseTitle,
	type Title,
} from "../utils/conventional.ts";

/** A `## Title` section per group of conventional types, then the rest. */
export const conventionalNotes = defineStep({
	type: "release-notes",
	name: "conventional-notes",
	description:
		"A `## Features` and a `## Fixes` section, then `## Other` for everything else.",
	options: {
		sections: z
			.array(
				z.strictObject({
					title: z.string(),
					types: z.array(z.string()).describe("`type` or `type(scope)`"),
				}),
			)
			.default([
				{ title: "Features", types: ["feat"] },
				{ title: "Fixes", types: ["fix"] },
			])
			.describe(
				"Sections in order; a change goes in the first that lists its type.",
			),
		other: z
			.union([z.string(), z.literal(false)])
			.default("Other")
			.describe("The section for remaining changes; `false` leaves them out."),
	},
	run: ({ changes, kind, options }) => {
		const sections = [
			...options.sections,
			...(options.other === false ? [] : [{ title: options.other, types: [] }]),
		].map(({ title, types }) => ({ title, types, entries: [] as string[] }));
		const other = options.other === false ? undefined : sections.at(-1);
		for (const change of changes) {
			const title = change.title ? parseTitle(change.title) : undefined;
			const entry = format(change, title);
			if (entry === undefined) continue;
			const section =
				(title && sections.find((s) => matches(title, s.types))) ?? other;
			section?.entries.push(entry);
		}

		const notes = sections
			.filter(({ entries }) => entries.length > 0)
			.map(({ title, entries }) => `## ${title}\n\n${entries.join("\n")}`)
			.join("\n\n");
		const counts = sections.map(
			({ title, entries }) => `${title.toLowerCase()}: ${entries.length}`,
		);
		return { notes, reason: `${kind} release; ${counts.join(", ")}` };
	},
});

function matches(title: Title, types: readonly string[]): boolean {
	return (
		types.includes(title.type) ||
		(title.scope !== undefined &&
			types.includes(`${title.type}(${title.scope})`))
	);
}

function format(change: Change, parsed: Title | undefined): string | undefined {
	const text = parsed
		? `${parsed.scope ? `**${parsed.scope}:** ` : ""}${parsed.subject}`
		: (change.title ?? change.description?.split("\n")[0])?.trim();
	if (!text) return undefined;
	const breaking =
		parsed?.breaking ||
		mentionsBreaking(change.title) ||
		mentionsBreaking(change.description);
	return `- ${text}${breaking ? " **(breaking)**" : ""}`;
}
