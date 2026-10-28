import { basename, relative } from "node:path";
import { defineStep } from "../../core/define.ts";
import { z } from "../../core/options.ts";
import { exec } from "../../utils/exec.ts";
import { inComponent, resolveFiles } from "../../utils/files.ts";
import { joinList } from "../../utils/text.ts";

const NUGET = "https://api.nuget.org/v3/index.json";

/**
 * A version as NuGet names packages with it: without build metadata or
 * leading zeros, and lowercased, e.g. `1.0.0-RC.1+abc` as `1.0.0-rc.1`.
 */
function nugetVersion(version: string): string {
	const [stable = "", pre] = version
		.toLowerCase()
		.replace(/\+.*$/s, "")
		.split(/-(.*)/s);
	const parts = stable.split(".").map((part) => String(Number(part)));
	if (parts.length === 4 && parts[3] === "0") parts.pop();
	return pre ? `${parts.join(".")}-${pre}` : parts.join(".");
}

/**
 * Pushes the component's packed NuGet packages to nuget.org, or another
 * source: pack them first, e.g. with `dotnet pack -c Release`. Only the
 * packages of the version being released are pushed, their symbols with them.
 */
export const dotnetPublish = defineStep({
	phase: "release",
	name: "dotnet/publish",
	description:
		"Pushes the component's packed `.nupkg` packages of the release's version to nuget.org, or another source, with `dotnet nuget push`.",
	options: {
		files: z
			.union([z.string(), z.array(z.string()).min(1)])
			.default("**/*.nupkg")
			.describe(
				"Globs of the packages, relative to the component's directory; those of other versions, and symbol packages, are left out.",
			),
		source: z.string().default(NUGET),
		token: z
			.string()
			.optional()
			.describe(
				"The API key; defaults to `NUGET_API_KEY`. Without one, the source's credentials in NuGet's config are used.",
			),
	},
	run: async ({ env, component, version, options }) => {
		const dir = inComponent(env, component, ".").file;
		const patterns = [options.files].flat();
		// In a dry run, they may not be packed yet, from files not yet written.
		const resolved = await resolveFiles(dir, patterns).catch(
			(error: unknown) => {
				if (env.dryRun) return [];
				throw error;
			},
		);
		const all = resolved.filter(
			(file) => file.endsWith(".nupkg") && !file.endsWith(".symbols.nupkg"),
		);
		const suffix = `.${nugetVersion(version)}.nupkg`;
		const files = all.filter((file) =>
			basename(file).toLowerCase().endsWith(suffix),
		);
		if (files.length === 0 && env.dryRun) {
			return {
				output: { files: [], source: options.source, published: false },
				reason: `would push the packages of ${nugetVersion(version)} in ${patterns.join(", ")} to ${options.source}, once packed`,
			};
		}
		if (files.length === 0) {
			throw new Error(
				`no packages of ${nugetVersion(version)} in ${patterns.join(", ")}; pack them first`,
			);
		}
		const shown = files.map((file) =>
			relative(env.cwd, file).replaceAll("\\", "/"),
		);
		const target = `${joinList(shown)} to ${options.source}`;
		const output = { files: shown, source: options.source };

		if (env.dryRun) {
			return {
				output: { ...output, published: false },
				reason: `would push ${target}`,
			};
		}

		const token = options.token ?? process.env.NUGET_API_KEY;
		for (const file of files) {
			const args = ["nuget", "push", file, "--source", options.source];
			if (token) args.push("--api-key", token);
			await exec("dotnet", args, { cwd: dir }).catch((error: unknown) => {
				// The key is an argument, which the error repeats.
				const message = error instanceof Error ? error.message : String(error);
				throw new Error(token ? message.replaceAll(token, "***") : message);
			});
		}
		return {
			output: { ...output, published: true },
			reason: `pushed ${target}`,
		};
	},
});
