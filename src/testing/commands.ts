import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, vi } from "vitest";

/** How a stand-in command was run. */
interface Call {
	command: string;
	args: string[];
	cwd: string;
	env: Record<string, string>;
}

export interface FakeCommands {
	/**
	 * Puts a stand-in for `name` first on `PATH`, which records how it's run,
	 * then runs `script`, a POSIX shell script, e.g. to print what it would.
	 */
	define(name: string, script?: string): Promise<void>;
	/** Every call to the stand-ins, in order. */
	calls(): Promise<Call[]>;
}

/** Stand-ins for commands, for each test, e.g. for publishing tools. */
export function useFakeCommands(): FakeCommands {
	let bin = "";
	beforeEach(async () => {
		bin = await mkdtemp(join(tmpdir(), "rylease-bin-"));
		vi.stubEnv("PATH", `${bin}${delimiter}${process.env.PATH ?? ""}`);
	});
	afterEach(async () => {
		vi.unstubAllEnvs();
		await rm(bin, { recursive: true, force: true });
	});
	const log = () => join(bin, "calls.jsonl");
	return {
		async define(name, script = "") {
			const record = `require("node:fs").appendFileSync(${JSON.stringify(log())}, JSON.stringify({ command: ${JSON.stringify(name)}, args: process.argv.slice(1), cwd: process.cwd(), env: process.env }) + "\\n")`;
			const path = join(bin, name);
			await writeFile(
				path,
				`#!/bin/sh\nnode -e '${record}' -- "$@"\n${script}\n`,
			);
			await chmod(path, 0o755);
		},
		async calls() {
			const text = await readFile(log(), "utf8").catch(() => "");
			return text
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line) as Call);
		},
	};
}
