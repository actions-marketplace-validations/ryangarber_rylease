import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { released, runStep } from "../../testing/step.ts";
import { keepAChangelogReadUnreleased } from "./read-unreleased.ts";
import { keepAChangelogWriteRelease } from "./write-release.ts";

const changelog = `# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- A dark mode.
  It follows the system's.

- \`--json\` output.

### Fixed
* A crash on empty input.

## [1.0.0] - 2026-01-02

### Added

- Everything.

[unreleased]: https://github.com/me/demo/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/me/demo/releases/tag/v1.0.0
`;

let cwd: string;

beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "rylease-"));
	await writeFile(join(cwd, "CHANGELOG.md"), changelog);
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-10-20T12:00:00Z"));
});

afterEach(async () => {
	vi.useRealTimers();
	await rm(cwd, { recursive: true, force: true });
});

describe("keep-a-changelog/read-unreleased", () => {
	it("collects each entry, labeled with its section", async () => {
		expect(
			await runStep(
				keepAChangelogReadUnreleased(),
				{ previousVersion: "1.0.0" },
				{ cwd },
			),
		).toEqual({
			changes: [
				{
					title: "A dark mode.",
					description: "It follows the system's.",
					reason: "CHANGELOG.md line 9",
					labels: ["Added"],
				},
				{
					title: "`--json` output.",
					reason: "CHANGELOG.md line 12",
					labels: ["Added"],
				},
				{
					title: "A crash on empty input.",
					reason: "CHANGELOG.md line 15",
					labels: ["Fixed"],
				},
			],
			reason: "3 entries under ## [Unreleased] in CHANGELOG.md",
		});
	});

	it("finds nothing in an empty section, and fails without one", async () => {
		await writeFile(
			join(cwd, "CHANGELOG.md"),
			"## Unreleased\n\n## 1.0.0\n- x\n",
		);
		expect(
			await runStep(
				keepAChangelogReadUnreleased(),
				{ previousVersion: "1.0.0" },
				{ cwd },
			),
		).toEqual({
			changes: [],
			reason: "0 entries under ## Unreleased in CHANGELOG.md",
		});
		await writeFile(join(cwd, "CHANGELOG.md"), "# Changelog\n");
		await expect(
			runStep(
				keepAChangelogReadUnreleased(),
				{ previousVersion: "1.0.0" },
				{ cwd },
			),
		).rejects.toThrow("CHANGELOG.md has no '## [Unreleased]' section");
	});
});

describe("keep-a-changelog/write-release", () => {
	it("releases the unreleased entries, moving the compare links on", async () => {
		expect(
			await runStep(keepAChangelogWriteRelease(), released("1.1.0"), { cwd }),
		).toEqual({
			output: {
				path: "CHANGELOG.md",
				heading: "## [1.1.0] - 2026-10-20",
				written: true,
			},
			files: ["CHANGELOG.md"],
			reason:
				"added ## [1.1.0] - 2026-10-20 and its compare link to CHANGELOG.md",
		});
		expect(await readFile(join(cwd, "CHANGELOG.md"), "utf8")).toBe(
			changelog
				.replace(
					"## [Unreleased]\n",
					"## [Unreleased]\n\n## [1.1.0] - 2026-10-20\n",
				)
				.replace(
					"[unreleased]: https://github.com/me/demo/compare/v1.0.0...HEAD",
					"[unreleased]: https://github.com/me/demo/compare/v1.1.0...HEAD\n[1.1.0]: https://github.com/me/demo/compare/v1.0.0...v1.1.0",
				),
		);
	});

	it("works without links, and changes nothing in a dry run", async () => {
		await writeFile(join(cwd, "CHANGELOG.md"), "## [Unreleased]\n- x\n");
		expect(
			(
				await runStep(
					keepAChangelogWriteRelease({ heading: "## {version}" }),
					released("2026.10.0"),
					{ cwd, dryRun: true },
				)
			).reason,
		).toBe("would add ## 2026.10.0 to CHANGELOG.md");
		expect(await readFile(join(cwd, "CHANGELOG.md"), "utf8")).toBe(
			"## [Unreleased]\n- x\n",
		);
		await runStep(
			keepAChangelogWriteRelease({ heading: "## {version}" }),
			released("2026.10.0"),
			{ cwd },
		);
		expect(await readFile(join(cwd, "CHANGELOG.md"), "utf8")).toBe(
			"## [Unreleased]\n\n## 2026.10.0\n- x\n",
		);
	});
});
