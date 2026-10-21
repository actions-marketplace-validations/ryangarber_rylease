import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	assertFullHistory,
	detectRepo,
	git,
	identity,
	parseGitHubRepo,
	tryGit,
} from "./git.ts";

let cwd: string;

beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "rylease-git-"));
	await git(cwd, "init", "-q", "-b", "main");
	vi.stubEnv("GITHUB_REPOSITORY", "");
	vi.stubEnv("GITHUB_ACTIONS", "");
	vi.stubEnv("GITLAB_CI", "");
	// Keep the user's own config out of `config user.email`.
	vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
	vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
});

afterEach(async () => {
	vi.unstubAllEnvs();
	await rm(cwd, { recursive: true, force: true });
});

describe("git", () => {
	it("resolves with trimmed output, and rejects with git's error", async () => {
		expect(await git(cwd, "symbolic-ref", "--short", "HEAD")).toBe("main");
		await expect(git(cwd, "rev-parse", "nope")).rejects.toThrow(
			/^git rev-parse nope failed: .*nope/s,
		);
		expect(await tryGit(cwd, "rev-parse", "nope")).toBeUndefined();
		expect(await tryGit(cwd, "symbolic-ref", "HEAD")).toBe("refs/heads/main");
	});
});

describe("parseGitHubRepo", () => {
	it.each([
		["git@github.com:ryangarber/rylease.git", "ryangarber/rylease"],
		["https://github.com/ryangarber/rylease", "ryangarber/rylease"],
		["https://github.com/ryangarber/rylease.git", "ryangarber/rylease"],
		["https://github.com/ryangarber/rylease/\n", "ryangarber/rylease"],
		["https://gitlab.com/a/b.git", undefined],
	])("%s → %s", (url, repo) => {
		expect(parseGitHubRepo(url)).toBe(repo);
	});
});

describe("detectRepo", () => {
	it("prefers GITHUB_REPOSITORY, then the origin remote", async () => {
		expect(await detectRepo(cwd)).toBeUndefined();
		await git(cwd, "remote", "add", "origin", "git@github.com:me/demo.git");
		expect(await detectRepo(cwd)).toBe("me/demo");
		vi.stubEnv("GITHUB_REPOSITORY", "you/other");
		expect(await detectRepo(cwd)).toBe("you/other");
	});
});

describe("identity", () => {
	it("sets the bot as author only in GitHub Actions without one", async () => {
		expect(await identity(cwd)).toEqual([]);
		vi.stubEnv("GITHUB_ACTIONS", "true");
		expect(await identity(cwd)).toEqual([
			"-c",
			"user.name=github-actions[bot]",
			"-c",
			"user.email=41898282+github-actions[bot]@users.noreply.github.com",
		]);
		await git(cwd, "config", "user.email", "me@example.com");
		expect(await identity(cwd)).toEqual([]);
	});

	it("sets the pipeline's user in GitLab CI without one", async () => {
		vi.stubEnv("GITLAB_CI", "true");
		vi.stubEnv("GITLAB_USER_NAME", "Ada");
		vi.stubEnv("GITLAB_USER_EMAIL", "ada@example.com");
		expect(await identity(cwd)).toEqual([
			"-c",
			"user.name=Ada",
			"-c",
			"user.email=ada@example.com",
		]);
	});
});

describe("assertFullHistory", () => {
	it("rejects shallow clones", async () => {
		const run = (...args: string[]) =>
			git(cwd, "-c", "user.name=t", "-c", "user.email=t@e", ...args);
		await run("commit", "-q", "--allow-empty", "-m", "one");
		await run("commit", "-q", "--allow-empty", "-m", "two");
		await expect(assertFullHistory(cwd)).resolves.toBeUndefined();

		const shallow = join(cwd, "shallow");
		await git(cwd, "clone", "-q", "--depth", "1", `file://${cwd}`, shallow);
		await expect(assertFullHistory(shallow)).rejects.toThrow(
			"the repository is a shallow clone; fetch full history (e.g. `fetch-depth: 0`)",
		);
	});
});
