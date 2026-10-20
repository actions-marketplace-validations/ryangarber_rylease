import { defineStep } from "../../core/define.ts";
import { z } from "../../core/options.ts";
import { KINDS, type Kind } from "../../core/types.ts";
import { lookup } from "./labels.ts";

const RANK: Record<Kind, number> = { none: 0, fix: 1, feature: 2, breaking: 3 };

/**
 * Each change's kind comes from its labels, e.g. a pull request's: the
 * highest of them, or `fallback` when none is mapped. The highest kind wins.
 */
export const labelsDetermineKind = defineStep({
	type: "determine-kind",
	name: "labels/determine-kind",
	description:
		"By each change's labels, e.g. a pull request's (`breaking` → breaking, `enhancement` → feature, anything else → fix). The highest kind wins.",
	needs: ["changes.labels"],
	options: {
		kinds: z
			.record(z.string(), z.enum(KINDS))
			.default({
				breaking: "breaking",
				"semver:major": "breaking",
				feature: "feature",
				enhancement: "feature",
				"semver:minor": "feature",
			})
			.describe("Kinds by label, ignoring case."),
		fallback: z
			.enum(KINDS)
			.default("fix")
			.describe("The kind of a change without a label in `kinds`."),
	},
	run: ({ changes, options }) => {
		let best: { kind: Kind; reason: string } | undefined;
		for (const change of changes) {
			let candidate = {
				kind: options.fallback,
				reason: `no label in kinds (${change.reason})`,
			};
			for (const label of change.labels ?? []) {
				const kind = lookup(options.kinds, label);
				if (kind !== undefined && RANK[kind] > RANK[candidate.kind]) {
					candidate = { kind, reason: `'${label}' label (${change.reason})` };
				}
			}
			if (!best || RANK[candidate.kind] > RANK[best.kind]) best = candidate;
			if (best.kind === "breaking") break;
		}
		return best ?? { kind: "none", reason: "no changes" };
	},
});
