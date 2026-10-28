import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { useRepo } from "../../../../src/testing/repo.ts";
import { git } from "../../../../src/utils/git.ts";
import { runCli } from "../testing/cli.ts";

const repo = useRepo();
const run = (...argv: string[]) => runCli(repo.cwd, "test", ...argv);

const source = (path: string) =>
	pathToFileURL(
		fileURLToPath(new URL(`../../../../src/${path}`, import.meta.url)),
	).href;

const WORKFLOW = `name: release
on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      publish: { type: boolean, default: false }
env:
  DRY_RUN: \${{ github.event_name != 'workflow_dispatch' || !inputs.publish }}
jobs:
  release:
    runs-on: ubuntu-latest
    outputs:
      released: \${{ steps.rylease.outputs.released }}
      version: \${{ steps.rylease.outputs.version }}
      notes: \${{ steps.rylease.outputs.notes }}
    steps:
      - uses: actions/checkout@v7
        with: { fetch-depth: 0 }
      - run: echo building
      - uses: ./
        id: rylease
        with:
          dry-run: \${{ env.DRY_RUN }}
          steps: |
            - uses: conventional
              with: { github/create-release: false }
  upload:
    needs: release
    if: needs.release.outputs.released == 'true'
    runs-on: ubuntu-latest
    strategy:
      matrix:
        os: [linux, mac]
    steps:
      - uses: actions/checkout@v7
      - id: build
        run: make
      - uses: ./
        with:
          version: \${{ needs.release.outputs.version }}
          notes: \${{ needs.release.outputs.notes }}
          dry-run: true
          scheme: semver
          history: git/tags
          steps: |
            - uses: exec/command
              with: { phase: release, command: "upload \${{ steps.build.outputs.artifact }} for \${{ matrix.os }}" }
`;

beforeEach(async () => {
	// A local rylease action, run from rylease's source, with the real action's inputs.
	const manifest = await readFile(
		new URL("../../../../action.yml", import.meta.url),
		"utf8",
	);
	await mkdir(join(repo.cwd, ".github/workflows"), { recursive: true });
	await repo.commit("chore: add the workflow", {
		"action.yml": manifest.replace("main: dist/action.mjs", "main: run.mjs"),
		"run.mjs": `const { provideSelf, runAction } = await import(${JSON.stringify(source("internal.ts"))});
provideSelf(${JSON.stringify(source("index.ts"))});
process.exitCode = await runAction();
`,
		".github/workflows/release.yml": WORKFLOW,
	});
});

describe("rylease test", () => {
	it("plays the workflow's jobs, passing outputs to the jobs that need them", async () => {
		const { code, out, err } = await run(
			"--event",
			"push",
			"--ref",
			"main",
			"--output",
			"upload.build.artifact=app.zip",
		);
		expect(err).toBe("");
		expect(code).toBe(0);
		expect(out).toContain(
			".github/workflows/release.yml on push (refs/heads/main at",
		);
		expect(out).toContain("✔ actions/checkout@v7  checked out");
		expect(out).toContain(
			"· run: echo building  not simulated; supposed to succeed",
		);
		expect(out).toContain("✔ ./  released, by the checkout's rylease");
		expect(out).toContain("● upload (linux)");
		expect(out).toContain("● upload (mac)");
		expect(out).toContain("would run upload app.zip for mac");
		// The checkout of upload is shallow, but it only uploads.
		expect(out).toContain("fetch-depth 1");
		expect(out).not.toContain("runs for real");
		expect(await git(repo.cwd, "tag")).toBe("");
	});

	it("tells what CI would do for real, and still does a dry run", async () => {
		const { code, out } = await run(
			"--event",
			"workflow_dispatch",
			"--input",
			"publish=true",
			"--json",
		);
		expect(code).toBe(0);
		const result = JSON.parse(out);
		const step = result.jobs[0].legs[0].steps[2];
		expect(step).toMatchObject({
			kind: "simulated",
			status: "success",
			dryRun: "false",
		});
		expect(step.outputs).toMatchObject({
			status: "released",
			released: "true",
		});
		expect(result.jobs.map((job: { status: string }) => job.status)).toEqual([
			"success",
			"success",
		]);
		expect(await git(repo.cwd, "tag")).toBe("");
		expect(
			(await run("--event", "workflow_dispatch", "--input", "publish=true"))
				.out,
		).toContain(
			"in CI, this runs for real (dry-run: 'false'); here it was a dry run",
		);
	});

	it("says when the workflow doesn't run, and why", async () => {
		expect(await run("--event", "pull_request")).toEqual({
			code: 0,
			out: expect.stringContaining(
				"it doesn't run on pull_request, only on push, workflow_dispatch\nNothing runs; pass --force to run its jobs anyway.\n",
			),
			err: "",
		});
		await git(repo.cwd, "checkout", "-b", "feature");
		expect((await run()).out).toContain(
			"branch feature isn't in its branches: main",
		);
	});

	it("lists what was read but not mocked, with mocks for it", async () => {
		const { out } = await run("--ref", "main");
		expect(out).toContain("Read but not set (empty here)");
		expect(out).toContain("steps.build.outputs.artifact  at release.yml:39");
		expect(out).toContain("would run upload  for linux");
	});

	it("includes uncommitted changes, unless told not to", async () => {
		await writeFile(join(repo.cwd, "rylease.yml"), "tag: release-{version}\n");
		const tag = async (...argv: string[]) => {
			const { out } = await run("--ref", "main", "--json", ...argv);
			const outputs = JSON.parse(out).jobs[0].outputs;
			expect(outputs.released).toBe("true");
			const step = JSON.parse(out).jobs[0].legs[0].steps[2];
			return JSON.parse(step.outputs.components)[
				Object.keys(JSON.parse(step.outputs.components))[0] ?? ""
			].tag;
		};
		expect(await tag()).toMatch(/^release-/);
		expect(await tag("--committed")).toMatch(/^v/);
	});

	it("reads mocks and their scenarios from a file", async () => {
		await writeFile(
			join(repo.cwd, ".github/rylease.mocks.yml"),
			"outputs:\n  upload.build: { artifact: from-file.zip }\nscenarios:\n  dispatch:\n    event: workflow_dispatch\n    inputs: { publish: 'true' }\n",
		);
		const { out } = await run("--scenario", "dispatch", "--ref", "main");
		expect(out).toContain("on workflow_dispatch");
		expect(out).toContain("run: make  outputs mocked");
		expect(out).toContain("runs for real");
		expect((await run("--scenario", "nope")).err).toBe(
			`rylease: --scenario: no 'nope' in ${join(await realCwd(), ".github/rylease.mocks.yml")}; use dispatch\n`,
		);
	});

	it("fails when a rylease step does", async () => {
		await repo.commit("ci: break it", {
			".github/workflows/release.yml": WORKFLOW.replace(
				"uses: conventional",
				"uses: nope",
			),
		});
		const { code, out } = await run("--ref", "main");
		expect(code).toBe(1);
		expect(out).toContain("unknown step nope");
		expect(out).toContain("○ upload: skipped, its if is false");
	});
});

async function realCwd() {
	return git(repo.cwd, "rev-parse", "--show-toplevel");
}
