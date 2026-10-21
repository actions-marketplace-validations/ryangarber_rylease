import { defineStep } from "../../core/define.ts";
import { z } from "../../core/options.ts";
import { KINDS, type Kind } from "../../core/types.ts";
import { classify } from "./classify.ts";

const RANK: Record<Kind, number> = { none: 0, fix: 1, feature: 2, breaking: 3 };

/**
 * `!` or `BREAKING` → breaking; otherwise each change's kind comes from its
 * conventional type, and the highest kind wins.
 */
export const conventionalDetermineKind = defineStep({
	type: "determine-kind",
	name: "conventional/determine-kind",
	description:
		"`!` or `BREAKING` → breaking; otherwise by conventional type (`feat` → feature, anything else → fix). The highest kind wins.",
	options: {
		types: z
			.record(z.string(), z.enum(KINDS))
			.default({})
			.describe(
				"Kinds by `type` or `type(scope)`, on top of `feat: feature`, e.g. `{ docs: none, chore(deps): fix }`.",
			),
		fallback: z
			.enum(KINDS)
			.default("fix")
			.describe("The kind of any other change, untyped ones included."),
	},
	run: ({ changes, options }) => {
		const rules = {
			types: { feat: "feature", ...options.types } as const,
			fallback: options.fallback,
		};
		let best: { kind: Kind; reason: string } | undefined;
		for (const change of changes) {
			const candidate = classify(change, rules);
			if (!best || RANK[candidate.kind] > RANK[best.kind]) best = candidate;
			if (best.kind === "breaking") break;
		}
		return best ?? { kind: "none", reason: "no changes" };
	},
});
