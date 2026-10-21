import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, vi } from "vitest";
import { git } from "../utils/git.ts";

export interface Repo {
	/** Holds the repository and its remote. */
	root: string;
	/** The working copy. */
	cwd: string;
	/** A bare repository, as `origin`. */
	remote: string;
	/** Writes files, stages everything and commits, even with no changes. */
	commit(message: string, files?: Record<string, string>): Promise<void>;
}

/** A `package.json` at `version`. */
export const pkg = (version: string) =>
	`${JSON.stringify({ name: "demo", version }, null, 2)}\n`;

/**
 * A fresh repository for each test, pushed to `origin`, whose history ends with
 * the 1.0.0 release (only set in `package.json`, not tagged) and then:
 *
 * - `feat: add a`
 * - `update readme`
 * - a squashed commit holding `fix(x)!: change b` and `feat: add c`
 */
export function useRepo(): Repo {
	// These suites run real Git processes, often through several release cycles.
	// Give setup, test bodies and cleanup headroom under parallel/CI load while
	// leaving Vitest's shorter defaults in place for other suites.
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

	const repo: Repo = {
		root: "",
		cwd: "",
		remote: "",
		async commit(message, files = {}) {
			for (const [name, content] of Object.entries(files)) {
				await writeFile(join(repo.cwd, name), content);
			}
			await git(repo.cwd, "add", "-A");
			await git(repo.cwd, "commit", "--allow-empty", "-m", message);
		},
	};

	beforeEach(async () => {
		// Without a GitHub repository, changes aren't linked.
		vi.stubEnv("GITHUB_REPOSITORY", "");
		vi.stubEnv("GITHUB_ACTIONS", "");
		vi.stubEnv("CI_PROJECT_URL", "");
		vi.stubEnv("GITLAB_CI", "");
		repo.root = await mkdtemp(join(tmpdir(), "rylease-"));
		repo.cwd = join(repo.root, "work");
		repo.remote = join(repo.root, "remote.git");
		const { cwd, root, remote } = repo;
		await git(root, "init", "--bare", "-b", "main", remote);
		await git(root, "init", "-b", "main", cwd);
		await git(cwd, "config", "user.name", "Test");
		await git(cwd, "config", "user.email", "test@example.com");
		await git(cwd, "config", "commit.gpgsign", "false");
		await git(cwd, "config", "tag.gpgsign", "false");
		await git(cwd, "remote", "add", "origin", remote);

		await repo.commit("chore: init", { "package.json": pkg("0.9.0") });
		await repo.commit("feat: before the release");
		await repo.commit("chore(release): v1.0.0", {
			"package.json": pkg("1.0.0"),
		});
		await repo.commit("feat: add a", { "a.txt": "a" });
		await repo.commit("update readme");
		await repo.commit(
			"Squashed (#3)\n\nfix(x)!: change b\n\nBody of b.\n\nfeat: add c\n",
			{ "b.txt": "b" },
		);
		await git(cwd, "push", "-u", "origin", "main");
	});

	afterEach(async () => {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
		await rm(repo.root, { recursive: true, force: true });
	});

	return repo;
}
