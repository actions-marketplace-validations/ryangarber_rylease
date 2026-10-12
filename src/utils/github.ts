import { tryGit } from "./git.ts";

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
