import { defineStep } from "../../core/define.ts";
import { z } from "../../core/options.ts";
import type { Kind } from "../../core/types.ts";
import { joinList, plural } from "../../utils/text.ts";

const RANK: Record<Kind, number> = { none: 0, fix: 1, feature: 2, breaking: 3 };

/**
 * Releases the components that depend on a released component, so their
 * releases pick up the new version, e.g. with `npm/write-version` updating
 * their dependency on it. Dependents of dependents follow.
 */
export const componentsDependents = defineStep({
	phase: "determine-kind",
	name: "components/dependents",
	scope: "all",
	description:
		"Releases each component that depends on a released one, as at least a `fix`; list it after the steps that determine kinds.",
	options: {
		kind: z
			.enum(["breaking", "feature", "fix"])
			.default("fix")
			.describe("The least kind of a dependent's release."),
		on: z
			.array(z.enum(["breaking", "feature", "fix"]))
			.default(["breaking", "feature", "fix"])
			.describe(
				"The kinds of a dependency's release that release its dependents.",
			),
	},
	run: ({ components, options }) => {
		const kinds = new Map(
			components.map(({ component, kind }) => [component.name, kind ?? "none"]),
		);
		const results: Record<string, { kind: Kind; reason: string }> = {};
		// Dependencies come first, so their own raised kinds count.
		for (const { component } of components) {
			const released = component.dependsOn.filter((name) => {
				const kind = kinds.get(name) ?? "none";
				return kind !== "none" && options.on.includes(kind);
			});
			const current = kinds.get(component.name) ?? "none";
			if (released.length === 0 || RANK[current] >= RANK[options.kind]) {
				continue;
			}
			kinds.set(component.name, options.kind);
			results[component.name] = {
				kind: options.kind,
				reason: `depends on ${joinList(released)}, released too`,
			};
		}
		const raised = Object.keys(results);
		return {
			results,
			reason:
				raised.length > 0
					? `${plural(raised.length, "dependent")} released: ${joinList(raised)}`
					: "no dependents of released components",
		};
	},
});
