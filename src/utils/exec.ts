import { execFile } from "node:child_process";

/** Runs a command and resolves with its trimmed stdout; fails with its stderr. */
export function exec(
	command: string,
	args: readonly string[],
	options: { cwd: string; env?: NodeJS.ProcessEnv },
): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			command,
			args,
			{ ...options, maxBuffer: 64 * 1024 * 1024 },
			(error, stdout, stderr) => {
				if (error) {
					const detail = stderr.trim() || error.message;
					reject(new Error(`${command} ${args.join(" ")} failed: ${detail}`));
				} else {
					resolve(stdout.trim());
				}
			},
		);
	});
}
