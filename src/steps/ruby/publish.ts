import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, posix } from "node:path";
import { defineStep } from "../../core/define.ts";
import { z } from "../../core/options.ts";
import { exec } from "../../utils/exec.ts";
import { inComponent } from "../../utils/files.ts";
import { joinList } from "../../utils/text.ts";

const RUBYGEMS = "https://rubygems.org";

/** A version as RubyGems writes it, e.g. `1.0.0-rc.1` as `1.0.0.pre.rc.1`. */
function gemVersion(version: string): string {
	return version.replace("-", ".pre.");
}

/**
 * Packs the component's gem from its gemspec and pushes it to RubyGems, or
 * another host, after earlier steps wrote the new version to it.
 */
export const rubyPublish = defineStep({
	phase: "release",
	name: "ruby/publish",
	description:
		"Packs the component's gem with `gem build` and pushes it to RubyGems, or another host, with `gem push`.",
	options: {
		gemspec: z
			.string()
			.optional()
			.describe(
				"Relative to the component's directory; defaults to its one `*.gemspec`.",
			),
		host: z.string().default(RUBYGEMS),
		token: z
			.string()
			.optional()
			.describe(
				"Defaults to `GEM_HOST_API_KEY`, which `gem` reads itself; without one, its own credentials are used.",
			),
	},
	run: async ({ env, component, version, options }) => {
		const dir = inComponent(env, component, ".").file;
		let gemspec = options.gemspec;
		if (gemspec === undefined) {
			const found = (await readdir(dir)).filter((name) =>
				name.endsWith(".gemspec"),
			);
			if (found.length !== 1) {
				throw new Error(
					found.length === 0
						? `no gemspec in ${component.path}; set \`gemspec\``
						: `${joinList(found)} are in ${component.path}; set \`gemspec\` to one`,
				);
			}
			gemspec = found[0] as string;
		}
		const shown = posix.join(component.path, gemspec);
		const expected = gemVersion(version);
		const output = { gemspec: shown, version: expected, host: options.host };

		if (env.dryRun) {
			return {
				output: { ...output, gem: null, published: false },
				reason: `would build ${shown} and push it to ${options.host}`,
			};
		}

		const out = await mkdtemp(join(tmpdir(), "rylease-gem-"));
		try {
			const file = join(out, "package.gem");
			const built = await exec("gem", ["build", gemspec, "--output", file], {
				cwd: dir,
			});
			// e.g. `File: package.gem`, after `Version: 1.2.0`.
			const found = /^\s*Version:\s*(\S+)/m.exec(built)?.[1];
			const name =
				/^\s*Name:\s*(\S+)/m.exec(built)?.[1] ?? basename(gemspec, ".gemspec");
			// Never publish a version other than the one being released, e.g.
			// when no earlier step wrote it.
			if (found !== expected) {
				throw new Error(
					`${shown} is at ${found ?? "an unknown version"}, not ${expected}; write it first (fs/write-version, with format: ruby)`,
				);
			}
			const token = options.token ?? process.env.GEM_HOST_API_KEY;
			await exec("gem", ["push", file, "--host", options.host], {
				cwd: dir,
				env: token ? { ...process.env, GEM_HOST_API_KEY: token } : process.env,
			});
			return {
				output: { ...output, gem: `${name}-${expected}.gem`, published: true },
				reason: `pushed ${name}-${expected}.gem to ${options.host}`,
			};
		} finally {
			await rm(out, { recursive: true, force: true });
		}
	},
});
