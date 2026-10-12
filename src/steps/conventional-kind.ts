import { defineStep } from "../define.ts";
import { z } from "../options.ts";
import { KINDS, type Kind } from "../types.ts";
import { classify } from "../utils/conventional.ts";

const RANK: Record<Kind, number> = { none: 0, patch: 1, minor: 2, major: 3 };

/**
 * `!` or `BREAKING` → major; otherwise each change's kind comes from its
 * conventional type, and the highest kind wins.
 */
export const conventionalKind = defineStep({
	type: "release-kind",
	name: "conventional-kind",
	description:
		"`!` or `BREAKING` → major; otherwise by conventional type (`feat` → minor, anything else → patch). The highest kind wins.",
	options: {
		types: z
			.record(z.string(), z.enum(KINDS))
			.default({})
			.describe(
				"Kinds by `type` or `type(scope)`, on top of `feat: minor`, e.g. `{ docs: none, chore(deps): patch }`.",
			),
		fallback: z
			.enum(KINDS)
			.default("patch")
			.describe("The kind of any other change, untyped ones included."),
	},
	run: ({ changes, options }) => {
		const rules = {
			types: { feat: "minor", ...options.types } as const,
			fallback: options.fallback,
		};
		let best: { kind: Kind; reason: string } | undefined;
		for (const change of changes) {
			const candidate = classify(change, rules);
			if (!best || RANK[candidate.kind] > RANK[best.kind]) best = candidate;
			if (best.kind === "major") break;
		}
		return best ?? { kind: "none", reason: "no changes" };
	},
});
