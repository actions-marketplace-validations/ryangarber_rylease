import { defineStep } from "../../core/define.ts";
import { z } from "../../core/options.ts";
import { inComponent } from "../../utils/files.ts";
import { runCommand, tail } from "./run.ts";

/**
 * Runs a command for each component in the phase it's given: in `write`,
 * e.g. `cargo update --workspace` to update a lockfile; in `release`, e.g.
 * `cargo publish` or `docker push app:{version}`.
 */
export const execCommand = defineStep({
	phase: (options) => options.phase,
	name: "exec/command",
	description:
		"Runs a command for each component in its `phase`: `write` e.g. to update a lockfile, listing what it changes as `files`, or `release` e.g. `cargo publish` or `docker push app:{version}`.",
	options: {
		phase: z
			.enum(["write", "stage", "release"])
			.describe("The phase it runs in."),
		command: z
			.union([z.string(), z.array(z.string()).min(1)])
			.describe(
				"`{placeholders}` are filled in. Text runs in `sh -c`; a list runs as it is, without a shell.",
			),
		dryRun: z
			.union([z.string(), z.array(z.string()).min(1)])
			.optional()
			.describe(
				"Runs instead in a dry run, e.g. `cargo publish --dry-run`; without it, a dry run only says what it would run.",
			),
		cwd: z
			.string()
			.default(".")
			.describe("Where it runs, relative to the component's directory."),
		env: z
			.record(z.string(), z.string())
			.default({})
			.describe("More environment variables, with `{placeholders}` filled in."),
		files: z
			.array(z.string())
			.default([])
			.describe(
				"What it changes, relative to the component's directory, for `git/commit`.",
			),
	},
	run: async (input) => {
		const { env, component, options } = input;
		const files = options.files.map(
			(file) => inComponent(env, component, file).relative,
		);
		const { shown, stdout } = await runCommand(input, options);
		if (stdout === null) {
			return {
				output: { command: shown, stdout: null },
				files,
				reason: `would run ${shown}`,
			};
		}
		const last = tail(stdout);
		return {
			output: { command: shown, stdout },
			files,
			reason: `ran ${shown}${last ? `: ${last}` : ""}`,
		};
	},
});
