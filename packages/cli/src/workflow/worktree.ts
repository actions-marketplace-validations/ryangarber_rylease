import { execFile } from "node:child_process";
import { copyFile, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { git, tryGit } from "rylease";

/** Fresh checkouts of the repository, one per job, as CI has. */
export class Worktrees {
	readonly #cwd: string;
	readonly #paths: string[] = [];

	constructor(cwd: string) {
		this.#cwd = cwd;
	}

	/** The repository they're of. */
	get cwd(): string {
		return this.#cwd;
	}

	/** Where they are, e.g. to keep them for a look. */
	get paths(): readonly string[] {
		return this.#paths;
	}

	/**
	 * The working copy as a tree, untracked files and all (but not ignored
	 * ones); `undefined` when it's no different from HEAD. The index is left
	 * alone. It's laid over checkouts of HEAD as uncommitted changes, rather
	 * than committed, so that it adds no commit to read changes from.
	 */
	async snapshot(): Promise<string | undefined> {
		const cwd = this.#cwd;
		const index = resolve(
			cwd,
			await git(cwd, "rev-parse", "--git-path", "index"),
		);
		const scratch = await mkdtemp(join(tmpdir(), "rylease-index-"));
		const file = join(scratch, "index");
		try {
			await copyFile(index, file).catch(() => {});
			const env = { ...process.env, GIT_INDEX_FILE: file };
			await run(cwd, env, "add", "-A");
			const tree = await run(cwd, env, "write-tree");
			return tree === (await tryGit(cwd, "rev-parse", "HEAD^{tree}"))
				? undefined
				: tree;
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	}

	/**
	 * A new checkout of `sha`, detached, with `changes` (a tree) in its working
	 * copy if they're given. Its path has no symlinks in it.
	 */
	async checkout(sha: string, changes?: string): Promise<string> {
		const path = await mkdtemp(join(await realpath(tmpdir()), "rylease-test-"));
		await git(this.#cwd, "worktree", "add", "--detach", "--quiet", path, sha);
		this.#paths.push(path);
		if (changes) {
			await git(path, "checkout", changes, "--", ".");
			const deleted = await git(
				path,
				"diff",
				"--name-only",
				"-z",
				"--diff-filter=D",
				sha,
				changes,
			);
			for (const file of deleted.split("\0").filter(Boolean)) {
				await rm(join(path, file), { force: true });
			}
			await git(path, "reset", "--quiet");
		}
		return path;
	}

	async remove(): Promise<void> {
		for (const path of this.#paths.splice(0)) {
			await tryGit(this.#cwd, "worktree", "remove", "--force", path);
			await rm(path, { recursive: true, force: true });
		}
		await tryGit(this.#cwd, "worktree", "prune");
	}
}

function run(
	cwd: string,
	env: NodeJS.ProcessEnv,
	...args: string[]
): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			"git",
			args,
			{ cwd, env, maxBuffer: 64 * 1024 * 1024 },
			(error, stdout, stderr) => {
				if (error)
					reject(
						new Error(
							`git ${args.join(" ")} failed: ${stderr.trim() || error.message}`,
						),
					);
				else resolve(stdout.trim());
			},
		);
	});
}
