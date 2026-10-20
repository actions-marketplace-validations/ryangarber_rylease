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

/** `GITHUB_REPOSITORY`, or `owner/repo` from the `origin` remote. */
export async function detectRepo(cwd: string): Promise<string | undefined> {
	if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
	const url = await tryGit(cwd, "remote", "get-url", "origin");
	return url ? parseGitHubRepo(url) : undefined;
}

/** `git@github.com:o/r.git`, `https://github.com/o/r` and similar → `o/r`. */
export function parseGitHubRepo(url: string): string | undefined {
	return /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(url.trim())?.[1];
}

/** Rejects shallow clones, whose history would silently miss commits. */
export async function assertFullHistory(cwd: string): Promise<void> {
	if ((await git(cwd, "rev-parse", "--is-shallow-repository")) === "true") {
		throw new Error(
			"the repository is a shallow clone; fetch full history (e.g. `fetch-depth: 0`)",
		);
	}
}

/**
 * `git log` of the commits since `ref` (or all of them), touching a
 * component's pathspec. A component that's the whole project still only
 * counts the commits of the working directory, when that's a subdirectory.
 */
export async function logSince(
	cwd: string,
	options: {
		ref?: string | undefined;
		pathspec: readonly string[];
		format: string;
	},
): Promise<string> {
	const range = options.ref ? `${options.ref}..HEAD` : "HEAD";
	let pathspec = options.pathspec;
	if (pathspec.length === 0) {
		const prefix = await git(cwd, "rev-parse", "--show-prefix");
		if (prefix) pathspec = ["."];
	}
	return git(
		cwd,
		"log",
		`--format=${options.format}`,
		range,
		...(pathspec.length > 0 ? ["--", ...pathspec] : []),
	);
}

/**
 * The oldest commit of the latest run of commits in which `file` had
 * `version`, as `read` finds it in the file's content at each commit; that is,
 * the commit that set the version. `undefined` outside a git repository, or
 * when no commit has it.
 */
export async function findVersionCommit(
	cwd: string,
	file: string,
	version: string,
	read: (content: string) => string | undefined,
): Promise<string | undefined> {
	const log = await tryGit(cwd, "log", "--format=%H", "--", file);
	if (log === undefined) return undefined; // not a git repository
	await assertFullHistory(cwd);
	let found: string | undefined;
	for (const sha of log.split("\n").filter(Boolean)) {
		const content = await tryGit(cwd, "show", `${sha}:./${file}`);
		if (content === undefined || read(content) !== version) break;
		found = sha;
	}
	return found;
}

const BOT_IDENTITY = [
	"-c",
	"user.name=github-actions[bot]",
	"-c",
	"user.email=41898282+github-actions[bot]@users.noreply.github.com",
];

/**
 * Arguments that set the CI's identity when none is set, for commands that
 * commit or tag: the bot's in GitHub Actions, the user who started the
 * pipeline's in GitLab CI.
 */
export async function identity(cwd: string): Promise<string[]> {
	if (await tryGit(cwd, "config", "user.email")) return [];
	if (process.env.GITHUB_ACTIONS === "true") return BOT_IDENTITY;
	const { GITLAB_CI, GITLAB_USER_NAME, GITLAB_USER_EMAIL } = process.env;
	if (GITLAB_CI === "true" && GITLAB_USER_NAME && GITLAB_USER_EMAIL) {
		return [
			"-c",
			`user.name=${GITLAB_USER_NAME}`,
			"-c",
			`user.email=${GITLAB_USER_EMAIL}`,
		];
	}
	return [];
}
