import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cli } from "./cli.ts";
import { parseChangeFile } from "./steps/change-files/parse.ts";
import { useRepo } from "./testing/repo.ts";
import { git } from "./utils/git.ts";

const repo = useRepo();

async function run(...argv: string[]) {
	let out = "";
	let err = "";
	const code = await cli(argv, {
		cwd: repo.cwd,
		write: (text) => {
			out += text;
		},
		error: (text) => {
			err += text;
		},
	});
	return { code, out, err };
}

describe("rylease", () => {
	it("runs the config's release, writing outputs for GitLab", async () => {
		await git(repo.cwd, "tag", "v1.0.0", "HEAD~3");
		await writeFile(
			join(repo.cwd, "rylease.yml"),
			"steps:\n  - uses: conventional\n    with: { github/create-release: false }\nchannels:\n  next: {}\n",
		);
		const { code, out } = await run(
			"--dry-run",
			"--channel",
			"next",
			"--outputs",
			"release.env",
		);
		expect(code).toBe(0);
		expect(out).toContain("1.0.0 → 2.0.0-next.1 (breaking) · would release");
		const env = await readFile(join(repo.cwd, "release.env"), "utf8");
		expect(env).toContain("RYLEASE_STATUS=released\n");
		expect(env).toContain("RYLEASE_VERSION=2.0.0-next.1\n");
		expect(env).toContain("RYLEASE_PRERELEASE=true\n");
		expect(env).toMatch(/^RYLEASE_NOTES=### Breaking Changes\\n\\n- /m);
		expect(await git(repo.cwd, "tag")).toBe("v1.0.0");
	});

	it("prints the report as JSON", async () => {
		// Without a config, the conventional preset, here without a GitHub repository.
		await writeFile(
			join(repo.cwd, "rylease.config.ts"),
			"export default { steps: [{ uses: 'conventional', with: { 'github/create-release': false } }] };\n",
		);
		const { code, out } = await run("--dry-run", "--json");
		expect(code).toBe(0);
		expect(JSON.parse(out)).toMatchObject({
			status: "released",
			version: "0.1.0",
			env: { dryRun: true },
		});
	});

	it("fails on bad arguments and configs", async () => {
		expect(await run("--nope")).toMatchObject({
			code: 1,
			err: expect.stringContaining("rylease: Unknown option '--nope'"),
		});
		await writeFile(join(repo.cwd, "rylease.yml"), "stepz: []\n");
		expect((await run("--dry-run")).err).toBe(
			"rylease: config.stepz: unknown key; use steps, scheme, tag, history, components, channels\n",
		);
		await writeFile(
			join(repo.cwd, "rylease.yml"),
			"steps:\n  - uses: conventional\n    with: { github/create-release: { repo: 1 } }\n",
		);
		expect((await run("--dry-run")).code).toBe(1);
		expect((await run("help")).out).toContain("Usage: rylease");
	});

	it("adds change files", async () => {
		expect(
			await run(
				"add",
				"--component",
				"core:feature",
				"--component",
				"@x/cli",
				"--kind",
				"fix",
				"Add dark mode",
			),
		).toEqual({ code: 0, out: "wrote .changes/add-dark-mode.md\n", err: "" });
		expect(
			(await run("add", "--description", "More.", "Add dark mode")).out,
		).toBe("wrote .changes/add-dark-mode-2.md\n");
		const files = await readdir(join(repo.cwd, ".changes"));
		expect(files.sort()).toEqual(["add-dark-mode-2.md", "add-dark-mode.md"]);
		expect(
			parseChangeFile(
				await readFile(join(repo.cwd, ".changes/add-dark-mode.md"), "utf8"),
				"x",
			),
		).toEqual({
			kinds: { core: "feature", "@x/cli": "fix" },
			title: "Add dark mode",
		});
		expect(
			parseChangeFile(
				await readFile(join(repo.cwd, ".changes/add-dark-mode-2.md"), "utf8"),
				"x",
			),
		).toEqual({
			kinds: { kind: "fix" },
			title: "Add dark mode",
			description: "More.",
		});
		expect((await run("add", "--kind", "huge", "X")).err).toBe(
			"rylease: --kind: 'huge' isn't a kind; use breaking, feature, fix, none\n",
		);
		expect((await run("add")).code).toBe(1);
	});
});
