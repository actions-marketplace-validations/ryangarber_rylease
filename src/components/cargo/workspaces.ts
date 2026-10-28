import { glob, readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { type Component, defineComponents } from "../../core/components.ts";
import { z } from "../../core/options.ts";
import { tomlKey, tomlStrings, tomlValue } from "../../utils/toml.ts";

const packageName = tomlKey(["package"], "name");
const packageVersion = tomlKey(["package"], "version");

/**
 * The crates a manifest depends on, by name, from its dependency tables,
 * target-specific ones too: `core = "1"`, `core = { path = ".." }` and
 * `[dependencies.core]`.
 */
function dependencies(text: string): string[] {
	const names = new Set<string>();
	let inTable = false;
	for (const line of text.split("\n")) {
		const header = /^\s*\[([^[\]]+)\]/.exec(line);
		if (header) {
			const table = header[1]?.trim() ?? "";
			const named = /(?:^|\.)(?:dev-|build-)?dependencies\.([\w-]+)$/.exec(
				table,
			);
			if (named?.[1]) names.add(named[1]);
			inTable = /(?:^|\.)(?:dev-|build-)?dependencies$/.test(table);
			continue;
		}
		const key = inTable ? /^\s*"?([\w-]+)"?\s*=/.exec(line) : null;
		if (key?.[1]) names.add(key[1]);
	}
	return [...names];
}

/**
 * The crates of a Cargo workspace, as components named after them, each
 * depending on the workspace crates it lists as dependencies.
 */
export const cargoWorkspaces = defineComponents({
	name: "cargo/workspaces",
	description:
		"Each crate of the Cargo workspace with its own `version`, the root's too, named after it and depending on the workspace crates it depends on.",
	options: {
		private: z
			.boolean()
			.default(false)
			.describe("Include crates with `publish = false`."),
		exclude: z
			.array(z.string())
			.default([])
			.describe("Crates to leave out, by name."),
	},
	create: (options) => ({
		name: "cargo/workspaces",
		resolve: async (env) => {
			const root = await readFile(join(env.cwd, "Cargo.toml"), "utf8").catch(
				() => "",
			);
			const members = tomlStrings(tomlValue(root, "workspace", "members"));
			if (members.length === 0) {
				throw new Error(
					"no workspace: list its crates in Cargo.toml's [workspace] `members`",
				);
			}
			const excluded = tomlStrings(tomlValue(root, "workspace", "exclude")).map(
				(path) => posix.normalize(path).replace(/\/$/, ""),
			);
			// The root is a crate too when it has a [package].
			const paths = new Set<string>(["."]);
			for (const pattern of members) {
				for await (const match of glob(
					`${pattern.replace(/\/$/, "")}/Cargo.toml`,
					{ cwd: env.cwd },
				)) {
					const path =
						match.replaceAll("\\", "/").replace(/\/?Cargo\.toml$/, "") || ".";
					if (!excluded.includes(path)) paths.add(path);
				}
			}
			const found: { name: string; path: string; text: string }[] = [];
			for (const path of paths) {
				const text =
					path === "."
						? root
						: await readFile(join(env.cwd, path, "Cargo.toml"), "utf8");
				const name = packageName.read(text);
				// Crates sharing the workspace's version are released as one
				// component, not each as its own.
				if (name === undefined || packageVersion.read(text) === undefined) {
					continue;
				}
				const publish = tomlValue(text, "package", "publish");
				if (publish === "false" && !options.private) continue;
				if (options.exclude.includes(name)) continue;
				found.push({ name, path, text });
			}
			if (found.length === 0) {
				throw new Error(`no workspace crates with a version in ${env.cwd}`);
			}
			found.sort((a, b) => a.path.localeCompare(b.path));
			const names = new Set(found.map(({ name }) => name));
			return found.map(
				({ name, path, text }): Component => ({
					name,
					path,
					dependsOn: dependencies(text).filter(
						(dep) => names.has(dep) && dep !== name,
					),
				}),
			);
		},
	}),
});
