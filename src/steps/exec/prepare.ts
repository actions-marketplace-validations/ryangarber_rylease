import { defineStep } from "../../core/define.ts";
import { z } from "../../core/options.ts";
import { inComponent } from "../../utils/files.ts";
import { commandOptions, runCommand, tail } from "./command.ts";

/**
 * Runs a command that changes the project before it's committed, e.g.
 * `cargo update --workspace` to update a lockfile, for each component.
 */
export const execPrepare = defineStep({
	type: "prepare",
	name: "exec/prepare",
	description:
		"Runs a command for each component before the release is committed, e.g. to update a lockfile; `files` lists what it changes.",
	options: {
		...commandOptions,
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
