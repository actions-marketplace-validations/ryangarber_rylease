import { defineStep } from "../../core/define.ts";
import type { ChangeWith } from "../../core/types.ts";
import { plural } from "../../utils/text.ts";
import { directoryOption, kindFor, readChangeFiles } from "./files.ts";

/**
 * Collects the change files in `.changes/`: each says what changed, and
 * how much for each component it names. A change's label is its kind, for
 * `labels/determine-kind` and `labels/build-notes`.
 */
export const changeFilesRead = defineStep({
	phase: "read-changes",
	name: "change-files/read",
	scope: "all",
	provides: ["changes.title", "changes.labels"],
	description:
		"Collects the change files in `.changes/`, each naming the components it changes and how much, e.g. `core: feature`; each change is labeled with its kind.",
	options: { directory: directoryOption },
	run: async ({ env, components, options }) => {
		const files = await readChangeFiles(env.cwd, options.directory);
		const names = new Set(components.map(({ component }) => component.name));
		// `kind` alone is for a project that's one component, as a whole.
		const only =
			components.length === 1 && components[0]?.component.path === ".";
		for (const { path, file } of files) {
			for (const name of Object.keys(file.kinds)) {
				if (names.has(name) || (only && name === "kind")) continue;
				throw new Error(
					`${path} names '${name}', which isn't a component; use ${only ? "kind" : [...names].join(", ")}`,
				);
			}
		}
		const results: Record<
			string,
			{ changes: ChangeWith<"title" | "labels">[]; reason: string }
		> = {};
		for (const { component } of components) {
			const changes = files.flatMap(({ path, file }) => {
				const kind = kindFor(file, component.name, only);
				return kind === undefined
					? []
					: [
							{
								title: file.title,
								...(file.description && { description: file.description }),
								labels: [kind],
								reason: path,
							},
						];
			});
			results[component.name] = {
				changes,
				reason: `${plural(changes.length, "change file")} in ${options.directory}`,
			};
		}
		return {
			results,
			reason: `${plural(files.length, "change file")} in ${options.directory}`,
		};
	},
});
