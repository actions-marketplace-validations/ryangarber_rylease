import { basename, relative } from "node:path";
import { defineStep } from "../../core/define.ts";
import { z } from "../../core/options.ts";
import { exec } from "../../utils/exec.ts";
import { inComponent, resolveFiles } from "../../utils/files.ts";
import { joinList } from "../../utils/text.ts";
import { normalizePython } from "./version.ts";

const PYPI = "https://upload.pypi.org/legacy/";

/** The version in a wheel's or sdist's file name, or `undefined` for others. */
function distVersion(file: string): string | undefined {
	const name = basename(file);
	if (name.endsWith(".whl")) return name.split("-")[1];
	const sdist = /^(.+)-([^-]+)\.(tar\.gz|zip)$/.exec(name);
	return sdist?.[2];
}

/**
 * Uploads the component's built distributions to PyPI, or another index:
 * build them first, e.g. with `uv build`. Only the files of the version
 * being released are uploaded.
 */
export const pythonPublish = defineStep({
	phase: "release",
	name: "python/publish",
	description:
		"Uploads the component's built wheels and sdists of the release's version to PyPI, or another index, with `uv publish` or `twine upload`.",
	options: {
		files: z
			.union([z.string(), z.array(z.string()).min(1)])
			.default("dist/*")
			.describe(
				"Globs of the distributions, relative to the component's directory; those of other versions are left out.",
			),
		client: z.enum(["uv", "twine"]).default("uv"),
		registry: z.string().default(PYPI).describe("The index's upload URL."),
		token: z
			.string()
			.optional()
			.describe(
				"Defaults to `PYPI_TOKEN`; without one, the client's own auth is used, e.g. `uv`'s trusted publishing.",
			),
	},
	run: async ({ env, component, version, options }) => {
		const dir = inComponent(env, component, ".").file;
		const patterns = [options.files].flat();
		// In a dry run, they may not be built yet, from files not yet written.
		const all = await resolveFiles(dir, patterns).catch((error: unknown) => {
			if (env.dryRun) return [];
			throw error;
		});
		const wanted = normalizePython(version);
		const files = all.filter((file) => {
			const found = distVersion(file);
			return found !== undefined && normalizePython(found) === wanted;
		});
		const shown = (file: string) =>
			relative(env.cwd, file).replaceAll("\\", "/");
		if (files.length === 0 && env.dryRun) {
			return {
				output: {
					version: wanted,
					files: [],
					client: options.client,
					registry: options.registry,
					published: false,
				},
				reason: `would ${options.client} upload the distributions of ${wanted} in ${patterns.join(", ")} to ${options.registry}, once built`,
			};
		}
		if (files.length === 0) {
			const others = all.map(distVersion).filter((found) => found);
			throw new Error(
				`no distributions of ${wanted} in ${patterns.join(", ")}${others.length > 0 ? `, only of ${joinList([...new Set(others)] as string[])}` : ""}; build them first`,
			);
		}
		const target = `${joinList(files.map(shown))} to ${options.registry}`;
		const output = {
			version: wanted,
			files: files.map(shown),
			client: options.client,
			registry: options.registry,
		};

		if (env.dryRun) {
			return {
				output: { ...output, published: false },
				reason: `would ${options.client} upload ${target}`,
			};
		}

		const token = options.token ?? process.env.PYPI_TOKEN;
		if (options.client === "uv") {
			await exec(
				"uv",
				["publish", "--publish-url", options.registry, ...files],
				{
					cwd: dir,
					env: token
						? { ...process.env, UV_PUBLISH_TOKEN: token }
						: process.env,
				},
			);
		} else {
			await exec(
				"twine",
				[
					"upload",
					"--non-interactive",
					"--repository-url",
					options.registry,
					...files,
				],
				{
					cwd: dir,
					env: token
						? {
								...process.env,
								TWINE_USERNAME: "__token__",
								TWINE_PASSWORD: token,
							}
						: process.env,
				},
			);
		}
		return {
			output: { ...output, published: true },
			reason: `uploaded ${target}`,
		};
	},
});
