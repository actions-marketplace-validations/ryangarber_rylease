import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { defineRelease } from "../core/define.ts";
import { calver, semver } from "../schemes/index.ts";
import { useRepo } from "../testing/repo.ts";
import { git } from "../utils/git.ts";
import { keepAChangelog } from "./keep-a-changelog.ts";

const repo = useRepo();

const changelog = `# Changelog

## [Unreleased]

### Fixed

- A crash on empty input.

### Added

- A dark mode.
  It follows the system's.

## [1.0.0] - 2026-01-02

- Everything.

[unreleased]: https://github.com/me/demo/compare/v1.0.0...HEAD
`;

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
	await repo.commit("docs: changelog", { "CHANGELOG.md": changelog });
	await git(repo.cwd, "tag", "v1.0.0", "HEAD~1");
});

afterEach(() => {
	vi.useRealTimers();
});

describe("keep-a-changelog", () => {
	it("releases the unreleased section, committed and tagged", async () => {
		const report = await defineRelease({
			steps: keepAChangelog({ "github/create-release": false }),
			scheme: semver(),
		}).run({ cwd: repo.cwd, reporter: null });

		expect(report.records.map((r) => `${r.name}: ${r.reason}`)).toEqual([
			expect.stringMatching(
				/^git\/tags: v1\.0\.0 at [0-9a-f]{7}, nearest on HEAD$/,
			),
			"keep-a-changelog/read-unreleased: 2 entries under ## [Unreleased] in CHANGELOG.md",
			"labels/determine-kind: 'Added' label (CHANGELOG.md line 11)",
			"semver: 1.1.0: 'feature' from 1.0.0, bumps minor",
			"labels/build-notes: feature release; added: 1, fixed: 1",
			"keep-a-changelog/write-release: added ## [1.1.0] - 2026-10-20 and its compare link to CHANGELOG.md",
			expect.stringMatching(/^git\/commit: committed [0-9a-f]{7}$/),
			expect.stringMatching(
				/^git\/create-tag: tagged v1\.1\.0 at .* pushed to origin$/,
			),
		]);
		expect(report.notes).toBe(
			"### Added\n\n- A dark mode.\n  It follows the system's.\n\n### Fixed\n\n- A crash on empty input.",
		);
		const written = await readFile(join(repo.cwd, "CHANGELOG.md"), "utf8");
		expect(written).toContain(
			"## [Unreleased]\n\n## [1.1.0] - 2026-10-20\n\n### Fixed",
		);
		expect(written).toContain(
			"[unreleased]: https://github.com/me/demo/compare/v1.1.0...HEAD\n[1.1.0]: https://github.com/me/demo/compare/v1.0.0...v1.1.0",
		);
		expect(await git(repo.remote, "rev-parse", "v1.1.0^{commit}")).toBe(
			await git(repo.cwd, "rev-parse", "HEAD"),
		);

		// The next run finds the section empty.
		const next = await defineRelease({
			steps: keepAChangelog({ "github/create-release": false }),
			scheme: semver(),
		}).run({ cwd: repo.cwd, reporter: null });
		expect(next.status).toBe("unchanged");
	});

	it("dates releases with calver instead", async () => {
		const report = await defineRelease({
			steps: keepAChangelog({
				"github/create-release": false,
				"git/create-tag": { push: false },
			}),
			scheme: calver({ format: "YYYY.0M.MICRO" }),
			tag: "{version}",
		}).run({ cwd: repo.cwd, reporter: null });

		expect(report.version).toBe("2026.10.0");
		expect(await git(repo.cwd, "tag", "--points-at", "HEAD")).toBe("2026.10.0");
		expect(await readFile(join(repo.cwd, "CHANGELOG.md"), "utf8")).toContain(
			"## [2026.10.0] - 2026-10-20",
		);
	});
});
