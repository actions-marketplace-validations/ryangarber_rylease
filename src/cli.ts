#!/usr/bin/env node
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The @rylease/cli versions npx runs when the project hasn't installed it. */
const CLI_RANGE = "^0.1.0";

/** This package's root: @rylease/cli runs releases with it, whichever CLI runs. */
const ENGINE = fileURLToPath(new URL("..", import.meta.url));

interface Cli {
	run(argv: readonly string[], options?: { engine?: string }): Promise<number>;
}

interface ShimOptions {
	cwd?: string;
	/** Finds the project's CLI; `undefined` when it has none. */
	installed?: (cwd: string) => Promise<Cli | undefined>;
	/** Runs the CLI when it isn't installed; resolves with its exit code. */
	fallback?: (argv: readonly string[]) => Promise<number>;
}

/**
 * Runs `rylease`: the project's @rylease/cli if it has one, or else the
 * latest compatible one through npx. Either way, with this rylease.
 */
export async function shim(
	argv: readonly string[],
	{
		cwd = process.cwd(),
		installed = installedCli,
		fallback = npx,
	}: ShimOptions = {},
): Promise<number> {
	const cli = await installed(cwd);
	return cli ? cli.run(argv, { engine: ENGINE }) : fallback(argv);
}

async function installedCli(cwd: string): Promise<Cli | undefined> {
	let path: string;
	try {
		path = createRequire(join(cwd, "package.json")).resolve("@rylease/cli");
	} catch {
		return undefined;
	}
	return (await import(pathToFileURL(path).href)) as Cli;
}

function npx(argv: readonly string[]): Promise<number> {
	return new Promise((resolve, reject) => {
		const child = spawn(
			"npx",
			["--yes", `@rylease/cli@${CLI_RANGE}`, ...argv],
			{
				stdio: "inherit",
				env: { ...process.env, RYLEASE_ENGINE: ENGINE },
				shell: process.platform === "win32",
			},
		);
		child.on("error", reject);
		child.on("exit", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
	});
}

if (process.argv[1] && isMain(process.argv[1])) {
	void shim(process.argv.slice(2)).then(
		(code) => {
			process.exitCode = code;
		},
		(error: unknown) => {
			process.stderr.write(
				`rylease: ${error instanceof Error ? error.message : String(error)}\n`,
			);
			process.exitCode = 1;
		},
	);
}

/** Whether this module was run directly, maybe through a bin link. */
function isMain(script: string): boolean {
	try {
		return import.meta.url === pathToFileURL(realpathSync(script)).href;
	} catch {
		return false;
	}
}
