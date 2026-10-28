import { glob, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { type Component, defineComponents } from "../../core/components.ts";
import { z } from "../../core/options.ts";

const DEPENDENCY_FIELDS = ["dependencies", "dev_dependencies"] as const;

type Pubspec = Record<string, unknown>;

async function readYaml(path: string): Promise<Pubspec | undefined> {
	const text = await readFile(path, "utf8").catch(() => undefined);
	if (text === undefined) return undefined;
	const value: unknown = parse(text);
	return typeof value === "object" && value !== null ? (value as Pubspec) : {};
}

function strings(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

/**
 * Globs of the workspace's packages: the root pubspec's `workspace`, or
 * `packages` in melos.yaml for workspaces older than pub's own.
 */
async function getPackages(cwd: string): Promise<string[]> {
	const pubspec = await readYaml(join(cwd, "pubspec.yaml"));
	const workspace = strings(pubspec?.workspace);
	if (workspace.length > 0) return workspace;
	const melos = strings((await readYaml(join(cwd, "melos.yaml")))?.packages);
	if (melos.length > 0) return melos;
	throw new Error(
		"no workspace: list its packages in pubspec.yaml `workspace`, or in melos.yaml `packages`",
	);
}

/**
 * The packages of a pub workspace, or a Melos one, as components named after
 * them, each depending on the workspace packages it lists as dependencies.
 * The root is one too when it has a `version`, e.g. a Flutter app whose
 * packages live beside it.
 */
export const dartWorkspaces = defineComponents({
	name: "dart/workspaces",
	description:
		"Each package of the pub or Melos workspace with a `version`, the root's too, named after it and depending on the workspace packages it depends on.",
	options: {
		private: z
			.boolean()
			.default(false)
			.describe("Include packages with `publish_to: none`, e.g. apps."),
		exclude: z
			.array(z.string())
			.default([])
			.describe("Packages to leave out, by name."),
	},
	create: (options) => ({
		name: "dart/workspaces",
		resolve: async (env) => {
			const patterns = await getPackages(env.cwd);
			const paths = new Set<string>(["."]);
			for (const pattern of patterns) {
				for await (const match of glob(
					`${pattern.replace(/\/$/, "")}/pubspec.yaml`,
					{ cwd: env.cwd },
				)) {
					const path =
						match.replaceAll("\\", "/").replace(/\/?pubspec\.yaml$/, "") || ".";
					if (!path.split("/").some((part) => part.startsWith("."))) {
						paths.add(path);
					}
				}
			}
			const found: { name: string; path: string; pubspec: Pubspec }[] = [];
			for (const path of paths) {
				const pubspec = await readYaml(join(env.cwd, path, "pubspec.yaml"));
				const name = pubspec?.name;
				if (!pubspec || typeof name !== "string") continue;
				if (pubspec.version === undefined || pubspec.version === null) continue;
				if (pubspec.publish_to === "none" && !options.private) continue;
				if (options.exclude.includes(name)) continue;
				found.push({ name, path, pubspec });
			}
			if (found.length === 0) {
				throw new Error(`no workspace packages with a version in ${env.cwd}`);
			}
			found.sort((a, b) => a.path.localeCompare(b.path));
			const names = new Set(found.map(({ name }) => name));
			return found.map(({ name, path, pubspec }): Component => {
				const dependsOn = new Set<string>();
				for (const field of DEPENDENCY_FIELDS) {
					const deps = pubspec[field];
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
