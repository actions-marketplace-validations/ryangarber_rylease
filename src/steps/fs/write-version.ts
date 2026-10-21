import { readFile, writeFile } from "node:fs/promises";
import { posix, relative } from "node:path";
import { defineStep } from "../../core/define.ts";
import { z } from "../../core/options.ts";
import { isSemver } from "../../schemes/semver.ts";
import { inComponent, resolveFiles } from "../../utils/files.ts";
import { joinList } from "../../utils/text.ts";
import { FORMAT_NAMES, versionFormat } from "./formats.ts";

/**
 * Writes each component's new version to its version file, in the project's
 * own format, keeping everything else as it was. With the `npm` and `cargo`
 * formats, dependencies on the other components released with it are
 * pointed at their new versions too, keeping each range's operator.
 */
export const fsWriteVersion = defineStep({
	type: "prepare",
	name: "fs/write-version",
	scope: "all",
	description:
		"Writes each component's new version to its version file: `VERSION`, `package.json`, `Cargo.toml`, `pyproject.toml`, `Chart.yaml`, `gradle.properties`, `pom.xml`, or any file by pattern. With `npm` and `cargo`, it also updates dependencies on the other components released with it, and needs `version.semver`.",
	options: {
		format: z
			.enum(FORMAT_NAMES)
			.default("plain")
			.describe(
				"`plain` (the whole file), `npm`, `cargo`, `python`, `helm`, `gradle`, `maven`, or `pattern`.",
			),
		path: z
			.union([z.string(), z.array(z.string()).min(1)])
			.optional()
			.describe(
				"Relative to each component's directory; globs, or a list, write several, e.g. `packages/*/package.json` for packages sharing a version. Defaults to the format's file.",
			),
		pattern: z
			.string()
			.optional()
			.describe(
				'With the `pattern` format, where the version is, e.g. `__version__ = "{version}"`.',
			),
	},
	needs: (options) =>
		versionFormat(options.format, options.pattern ?? "{version}").needs ?? [],
	run: async ({ env, components, options }) => {
		const format = versionFormat(options.format, options.pattern);
		const patterns = [options.path ?? format.path].flat();
		if (patterns.includes("")) {
			throw new Error("the pattern format needs a `path`");
		}
		if (format.needs?.includes("version.semver")) {
			for (const { version } of components) {
				// npm and cargo would "clean" anything else, e.g. publish
				// 2026.01.0 as 2026.1.0, so the package and its tag would disagree.
				if (!isSemver(version)) {
					throw new Error(
						`${format.name} needs a semantic version, and '${version}' isn't one`,
					);
				}
			}
		}
		// Package names may differ from component names; read them all first.
		const files = (
			await Promise.all(
				components.map(async ({ component, version }) => {
					const dir = inComponent(env, component, ".").file;
					const found =
						options.format === "plain"
							? patterns.map(
									(pattern) => inComponent(env, component, pattern).file,
								)
							: await resolveFiles(dir, patterns);
					return Promise.all(
						found.map(async (file) => ({
							file,
							version,
							text: await readFile(file, "utf8").catch((error: unknown) => {
								if ((error as NodeJS.ErrnoException).code === "ENOENT") {
									return "";
								}
								throw error;
							}),
							relative: posix.normalize(
								relative(env.cwd, file).replaceAll("\\", "/"),
							),
						})),
					);
				}),
			)
		).flat();
		const packages = new Map<string, string>();
		for (const { text, version } of files) {
			const name = format.packageName?.(text);
			if (name !== undefined) packages.set(name, version);
		}
		const written: { path: string; version: string; dependencies: string[] }[] =
			[];
		for (const { file, version, text, relative: path } of files) {
			if (text === "" && options.format !== "plain") {
				throw new Error(`${path} doesn't exist`);
			}
			let result: { text: string; dependencies: string[] };
			try {
				result = format.write(text, version, packages);
			} catch (error) {
				throw new Error(
					`can't write ${version} to ${path}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			if (!env.dryRun) await writeFile(file, result.text);
			written.push({ path, version, dependencies: result.dependencies });
		}
		const described = joinList(
			written.map(
				({ path, version, dependencies }) =>
					`${version} to ${path}${dependencies.length > 0 ? ` (and ${joinList(dependencies)})` : ""}`,
			),
		);
		return {
			output: { written: env.dryRun ? [] : written },
			files: written.map(({ path }) => path),
			reason: `${env.dryRun ? "would write" : "wrote"} ${described}`,
		};
	},
});
