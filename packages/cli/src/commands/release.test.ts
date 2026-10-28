import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { useRepo } from "../../../../src/testing/repo.ts";
import { git } from "../../../../src/utils/git.ts";
import { runCli } from "../testing/cli.ts";

const repo = useRepo();
const run = (...argv: string[]) => runCli(repo.cwd, ...argv);

describe("rylease release", () => {
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
			err: "rylease: Unexpected option or subcommand: `--nope`; see rylease --help\n",
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
});
