import { glob, readFile } from "node:fs/promises";
import { join } from "node:path";
import { type Component, defineComponents } from "../../core/components.ts";
import { z } from "../../core/options.ts";
import { getPackages } from "./read.ts";

const DEPENDENCY_FIELDS = [
	"dependencies",
	"devDependencies",
	"peerDependencies",
	"optionalDependencies",
] as const;

/**
 * The packages of an npm, Yarn or pnpm workspace, as components named after
 * them, each depending on the workspace packages it lists as dependencies.
 */
export const npmWorkspaces = defineComponents({
	name: "npm/workspaces",
	description:
		"Each package of the npm, Yarn or pnpm workspace, named after it and depending on the workspace packages it depends on.",
	options: {
		private: z
			.boolean()
			.default(false)
			.describe("Include packages marked `private`."),
		exclude: z
			.array(z.string())
			.default([])
			.describe("Packages to leave out, by name."),
	},
	create: (options) => ({
		name: "npm/workspaces",
		resolve: async (env) => {
			const patterns = await getPackages(env.cwd);
			const found: {
				name: string;
				path: string;
				json: Record<string, unknown>;
			}[] = [];
			for (const pattern of patterns) {
				for await (const match of glob(
					`${pattern.replace(/\/$/, "")}/package.json`,
					{
						cwd: env.cwd,
					},
				)) {
					const path =
						match.replaceAll("\\", "/").replace(/\/?package\.json$/, "") || ".";
					if (path.includes("node_modules")) continue;
					const json = JSON.parse(
						await readFile(join(env.cwd, match), "utf8"),
					) as Record<string, unknown>;
					if (typeof json.name !== "string") continue;
					if (json.private === true && !options.private) continue;
					if (options.exclude.includes(json.name)) continue;
					if (!found.some((other) => other.path === path)) {
						found.push({ name: json.name, path, json });
					}
				}
			}
			if (found.length === 0) {
				throw new Error(`no workspace packages in ${env.cwd}`);
			}
			found.sort((a, b) => a.path.localeCompare(b.path));
			const names = new Set(found.map(({ name }) => name));
			return found.map(({ name, path, json }): Component => {
				const dependsOn = new Set<string>();
				for (const field of DEPENDENCY_FIELDS) {
					const deps = json[field];
					if (typeof deps !== "object" || deps === null) continue;
					for (const dep of Object.keys(deps)) {
						if (names.has(dep) && dep !== name) dependsOn.add(dep);
					}
				}
				return { name, path, dependsOn: [...dependsOn] };
			});
		},
	}),
});
