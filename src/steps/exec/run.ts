import { defineStep } from "../../core/define.ts";
import { commandOptions, runCommand, tail } from "./command.ts";

/**
 * Runs a command to ship the release, e.g. `cargo publish`, `uv publish` or
 * `docker push app:{version}`, for each component.
 */
export const execRun = defineStep({
	type: "release",
	name: "exec/run",
	description:
		"Runs a command for each component, with `{placeholders}` filled in, e.g. `cargo publish` or `docker push app:{version}`.",
	options: commandOptions,
	run: async (input) => {
		const { shown, stdout } = await runCommand(input, input.options);
		if (stdout === null) {
			return {
				output: { command: shown, stdout: null },
				reason: `would run ${shown}`,
			};
		}
		const last = tail(stdout);
		return {
			output: { command: shown, stdout },
			reason: `ran ${shown}${last ? `: ${last}` : ""}`,
		};
	},
});
