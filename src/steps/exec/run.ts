import { exec } from "../../utils/exec.ts";
import { inComponent } from "../../utils/files.ts";
import { fill } from "../../utils/template.ts";

type Command = string | readonly string[];

/**
 * Runs a step's command for a component, or in a dry run its `dryRun`
 * command if it has one; resolves with what it ran, and its output.
 */
export async function runCommand(
	input: {
		env: { cwd: string; dryRun: boolean };
		component: { path: string };
		placeholders: Readonly<Record<string, string>>;
	},
	options: {
		command: Command;
		dryRun?: Command | undefined;
		cwd: string;
		env: Readonly<Record<string, string>>;
	},
): Promise<{ shown: string; stdout: string | null }> {
	const { env, component, placeholders } = input;
	const command =
		env.dryRun && options.dryRun !== undefined
			? options.dryRun
			: options.command;
	const argv =
		typeof command === "string"
			? ["sh", "-c", fill(command, placeholders)]
			: command.map((part) => fill(part, placeholders));
	const shown = typeof command === "string" ? (argv[2] ?? "") : argv.join(" ");
	if (env.dryRun && options.dryRun === undefined) {
		return { shown, stdout: null };
	}
	const [program = "", ...args] = argv;
	const stdout = await exec(program, args, {
		cwd: inComponent(env, component, options.cwd).file,
		env: {
			...process.env,
			...Object.fromEntries(
				Object.entries(options.env).map(([key, value]) => [
					key,
					fill(value, placeholders),
				]),
			),
		},
	});
	return { shown, stdout };
}

/** The last lines of a command's output, for its reason. */
export function tail(stdout: string, lines = 1): string {
	const last = stdout
		.split("\n")
		.filter((line) => line.trim())
		.slice(-lines);
	return last.join(" ").slice(0, 200);
}
