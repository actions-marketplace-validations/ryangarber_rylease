import { or } from "@optique/core/constructs";
import { runParser } from "@optique/core/facade";
import { formatMessage, message } from "@optique/core/message";
import { OptionsError } from "rylease";
import { add, addCommand } from "./commands/add.ts";
import { release, releaseCommand } from "./commands/release.ts";
import { test, testCommand } from "./commands/test.ts";
import { type Io, issuesOf } from "./io.ts";

export type { Io } from "./io.ts";

const COMMANDS = ["release", "add", "test", "help"];

const parser = or(releaseCommand, addCommand, testCommand);

/** Shown instead of a command's values when help was asked for. */
const HELP = Symbol("help");

/** Runs the CLI; resolves with its exit code. */
export async function cli(argv: readonly string[], io: Io): Promise<number> {
	// Without a command, `release`, as before there were others.
	const args =
		COMMANDS.includes(argv[0] ?? "") || argv[0] === "--help" || argv[0] === "-h"
			? argv
			: ["release", ...argv];
	try {
		const values = runParser(parser, "rylease", args, {
			help: { command: true, option: true, onShow: () => HELP },
			brief: message`A release pipeline that doesn't fight you.`,
			footer: message`Run rylease <command> --help for a command's options.`,
			aboveError: "none",
			stdout: (text) => io.write(`${text}\n`),
			stderr: () => {},
			onError: (_code, error): never => {
				throw new OptionsError([
					`${formatMessage(error).replace(/\.$/, "")}; see rylease --help`,
				]);
			},
		});
		// runParser returns what onShow does, though its type doesn't say so.
		if ((values as unknown) === HELP) return 0;
		switch (values.command) {
			case "release":
				return await release(values, io);
			case "add":
				return await add(values, io);
			case "test":
				return await test(values, io);
		}
	} catch (error) {
		// A failed release has been reported already, step by step.
		for (const issue of issuesOf(error)) io.error(`rylease: ${issue}\n`);
		return 1;
	}
}
