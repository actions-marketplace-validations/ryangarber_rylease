import { execFile } from "node:child_process";

/** Runs `git` in `cwd` and resolves with its trimmed stdout. */
export function git(cwd: string, ...args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			"git",
			args,
			{ cwd, maxBuffer: 64 * 1024 * 1024 },
			(error, stdout, stderr) => {
				if (error) {
					const detail = stderr.trim() || error.message;
					reject(new Error(`git ${args.join(" ")} failed: ${detail}`));
				} else {
					resolve(stdout.trim());
				}
			},
		);
	});
}

/** Like {@link git}, but resolves with `undefined` instead of rejecting. */
export async function tryGit(
	cwd: string,
	...args: string[]
): Promise<string | undefined> {
	try {
		return await git(cwd, ...args);
	} catch {
		return undefined;
	}
}

/** Rejects shallow clones, whose history would silently miss commits. */
export async function assertFullHistory(cwd: string): Promise<void> {
	if ((await git(cwd, "rev-parse", "--is-shallow-repository")) === "true") {
		throw new Error(
			"the repository is a shallow clone; fetch full history (e.g. `fetch-depth: 0`)",
		);
	}
}
