import { engineRoot, useEngine } from "./engine.ts";

export interface RunOptions {
	/** The rylease package to run with; see {@link engineRoot}. */
	engine?: string;
	/** Defaults to the working directory. */
	cwd?: string;
}

/** Runs the CLI with `argv`, writing to stdout and stderr; resolves with its exit code. */
export async function run(
	argv: readonly string[],
	options: RunOptions = {},
): Promise<number> {
	const cwd = options.cwd ?? process.cwd();
	useEngine(engineRoot(cwd, options.engine));
	// Only now, so that its `rylease` imports resolve to the engine.
	const { cli } = await import("./main.ts");
	return cli(argv, {
		cwd,
		write: (text) => void process.stdout.write(text),
		error: (text) => void process.stderr.write(text),
		interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
	});
}
