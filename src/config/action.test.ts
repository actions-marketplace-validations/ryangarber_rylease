import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../utils/git.ts";
import { main } from "./action.ts";

let root: string;
let output: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "rylease-action-"));
	const cwd = join(root, "project");
	output = join(root, "output");
	await writeFile(output, "");
	await git(root, "init", "-b", "main", cwd);
	await git(cwd, "config", "user.name", "Test");
	await git(cwd, "config", "user.email", "test@example.com");
	await git(cwd, "config", "commit.gpgsign", "false");
	await git(cwd, "config", "tag.gpgsign", "false");
	await writeFile(
		join(cwd, "package.json"),
		JSON.stringify({ name: "demo", version: "1.0.0" }),
	);
	await git(cwd, "add", "-A");
	await git(cwd, "commit", "-m", "chore: init");
	await git(cwd, "tag", "v1.0.0");
	await git(cwd, "commit", "--allow-empty", "-m", "fix: a bug");
	await git(cwd, "commit", "--allow-empty", "-m", "docs: words");
});

afterEach(async () => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	await rm(root, { recursive: true, force: true });
});

const env = (steps?: string) => ({
	GITHUB_WORKSPACE: root,
	GITHUB_OUTPUT: output,
	"INPUT_WORKING-DIRECTORY": "project",
	"INPUT_DRY-RUN": "true",
	...(steps === undefined ? {} : { INPUT_STEPS: steps }),
});

async function outputs(): Promise<Record<string, string>> {
	const text = await readFile(output, "utf8");
	const result: Record<string, string> = {};
	for (const [, name = "", delimiter, value = ""] of text.matchAll(
		/^([\w-]+)<<(\S+)\n([\s\S]*?)\n\2$/gm,
	)) {
		expect(delimiter).toMatch(/^rylease_/);
		result[name] = value;
	}
	return result;
}

describe("action", () => {
	it("runs the conventional preset by default and sets outputs", async () => {
		vi.stubEnv("GITHUB_REPOSITORY", "me/demo");
		expect(await main(env(), null)).toBe(0);
		expect(await outputs()).toEqual({
			status: "released",
			released: "true",
			"previous-version": "1.0.0",
			version: "1.0.1",
			kind: "fix",
			notes: expect.stringMatching(
				/^### Bug Fixes\n\n- a bug \(\[[0-9a-f]{7}\]\(https:\/\/github\.com\/me\/demo\/commit\/[0-9a-f]{40}\)\)\n\n### Other\n\n- words \(\[[0-9a-f]{7}\]\(.+\)\)$/,
			),
			channel: "",
			prerelease: "false",
			components: expect.any(String),
			"released-components": '["root"]',
		});
		expect(JSON.parse((await outputs()).components ?? "")).toEqual({
			root: {
				path: ".",
				status: "released",
				released: true,
				"previous-version": "1.0.0",
				version: "1.0.1",
				tag: "v1.0.1",
				kind: "fix",
				notes: expect.stringMatching(/^### Bug Fixes/),
			},
		});
	});

	it("passes options from the steps input", async () => {
		const steps = [
			"- uses: conventional",
			"  with:",
			"    github/create-release: false",
			"    conventional/determine-kind:",
			"      types: { fix: none, docs: none }",
		].join("\n");
		expect(await main(env(steps), null)).toBe(0);
		expect(await outputs()).toMatchObject({
			status: "unchanged",
			released: "false",
			kind: "none",
		});
	});

	it("runs release steps for the version input", async () => {
		const steps = "- uses: github/create-release\n  with: { repo: me/demo }";
		expect(
			await main(
				{
					...env(steps),
					INPUT_SCHEME: "semver",
					INPUT_HISTORY: "git/tags",
					INPUT_VERSION: "3.0.0",
					INPUT_NOTES: "Hi",
				},
				null,
			),
		).toBe(0);
		expect(await outputs()).toEqual({
			status: "released",
			released: "true",
			"previous-version": "3.0.0",
			version: "3.0.0",
			kind: "fix",
			notes: "Hi",
			channel: "",
			prerelease: "false",
			components: expect.any(String),
			"released-components": '["root"]',
		});
	});

	it("writes a summary of the release, unless told not to", async () => {
		const summary = join(root, "summary.md");
		await writeFile(summary, "");
		vi.stubEnv("GITHUB_REPOSITORY", "me/demo");
		expect(await main({ ...env(), GITHUB_STEP_SUMMARY: summary }, null)).toBe(
			0,
		);
		expect(await readFile(summary, "utf8")).toMatch(
			/^### rylease dry run · \*\*1\.0\.0\*\* → \*\*1\.0\.1\*\* \(fix\) · would release\n/,
		);

		await writeFile(summary, "");
		expect(
			await main(
				{ ...env(), GITHUB_STEP_SUMMARY: summary, INPUT_SUMMARY: "false" },
				null,
			),
		).toBe(0);
		expect(await readFile(summary, "utf8")).toBe("");

		vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		expect(
			await main(
				{ ...env("- uses: nope"), GITHUB_STEP_SUMMARY: summary },
				null,
			),
		).toBe(1);
		expect(await readFile(summary, "utf8")).toMatch(
			/^### ❌ rylease · invalid input\n\n- steps\[0\]\.uses: unknown step/,
		);
	});

	it("fails with annotations for invalid input", async () => {
		const write = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		expect(
			await main(
				env("- uses: conventional/determine-notes\n  with: { shift: 1 }"),
				null,
			),
		).toBe(1);
		expect(await main(env("- [unclosed"), null)).toBe(1);
		expect(write.mock.calls.map(([text]) => text)).toEqual([
			'::error::steps[0].with: Unrecognized key: "shift"\n',
			expect.stringMatching(/^::error::steps: invalid YAML: /),
		]);
		expect(await readFile(output, "utf8")).toBe("");
	});

	it("fails with an annotation and a summary when a step fails", async () => {
		const write = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		vi.stubEnv("GITHUB_REPOSITORY", "me/demo");
		const summary = join(root, "summary.md");
		await writeFile(summary, "");
		const steps =
			"- uses: github/upload-release-assets\n  with: { files: [nope] }";
		expect(
			await main(
				{
					...env(steps),
					INPUT_SCHEME: "semver",
					INPUT_HISTORY: "git/tags",
					INPUT_VERSION: "1.0.1",
					GITHUB_STEP_SUMMARY: summary,
				},
				null,
			),
		).toBe(1);
		expect(write.mock.calls.map(([text]) => text)).toEqual([
			"::error::release step 'github/upload-release-assets' failed: no files match 'nope'\n",
		]);
		expect(await readFile(summary, "utf8")).toMatch(
			/^### ❌ rylease dry run · release failed\n[\s\S]*\| ❌ \| `release` \| `github\/upload-release-assets` \|/,
		);
		expect(await readFile(output, "utf8")).toBe("");
	});

	it("takes the scheme, tag and history inputs", async () => {
		const steps =
			"- uses: conventional\n  with: { github/create-release: false }";
		expect(
			await main(
				{
					...env(steps),
					INPUT_SCHEME: "{ uses: semver, with: { initial: 1.0.0 } }",
					INPUT_TAG: "release-{version}",
					INPUT_HISTORY:
						"[git/tags, { uses: fs/version-file, with: { format: npm } }]",
				},
				null,
			),
		).toBe(0);
		// No release-{version} tag: the version in package.json, set at the start.
		expect(await outputs()).toMatchObject({
			"previous-version": "1.0.0",
			version: "1.0.1",
		});
		expect(JSON.parse((await outputs()).components ?? "").root.tag).toBe(
			"release-1.0.1",
		);
	});

	it("reads a config file, which inputs override", async () => {
		const cwd = join(root, "project");
		await writeFile(
			join(cwd, "rylease.yml"),
			[
				"steps:",
				"  - uses: conventional",
				"    with: { github/create-release: false }",
				"tag: release-{version}",
				"channels:",
				"  next: { branches: [next] }",
			].join("\n"),
		);
		expect(await main({ ...env(), INPUT_CHANNEL: "next" }, null)).toBe(0);
		const outputs1 = await outputs();
		// The v1.0.0 tag isn't a release-{version} tag: all history counts.
		expect(outputs1).toMatchObject({
			version: "0.1.0-next.1",
			channel: "next",
			prerelease: "true",
		});

		await writeFile(output, "");
		expect(await main({ ...env(), INPUT_TAG: "v{version}" }, null)).toBe(0);
		expect(await outputs()).toMatchObject({ version: "1.0.1", channel: "" });
	});

	it("runs a release defined in TypeScript", async () => {
		const cwd = join(root, "project");
		const rylease = JSON.stringify(join(import.meta.dirname, "..", "index.ts"));
		await writeFile(
			join(cwd, "rylease.config.ts"),
			`import { defineRelease, presets, schemes } from ${rylease};
export default defineRelease({
	scheme: schemes.semver({ initial: "5.0.0" }),
	tag: "x{version}",
	steps: presets.conventional({ "github/create-release": false }),
});
`,
		);
		expect(await main(env(), null)).toBe(0);
		expect(await outputs()).toMatchObject({ version: "5.0.0" });
		const write = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		await writeFile(output, "");
		expect(await main({ ...env(), INPUT_TAG: "v{version}" }, null)).toBe(1);
		expect(write.mock.calls.map(([text]) => text)).toEqual([
			expect.stringMatching(
				/^::error::tag: .*rylease\.config\.ts defines the release; set tag there\n$/,
			),
		]);
	});

	it("rejects inputs that aren't booleans", async () => {
		const write = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		expect(await main({ ...env(), "INPUT_DRY-RUN": "yes" }, null)).toBe(1);
		expect(await main({ ...env(), INPUT_SUMMARY: "no" }, null)).toBe(1);
		expect(write.mock.calls.map(([text]) => text)).toEqual([
			"::error::dry-run: expected true or false, got 'yes'\n",
			"::error::summary: expected true or false, got 'no'\n",
		]);
	});

	it("passes the token input on to steps, unless there's a token", async () => {
		vi.stubEnv("GITHUB_TOKEN", undefined);
		vi.stubEnv("GH_TOKEN", undefined);
		// Too few steps to release: only the token is of interest.
		vi.spyOn(process.stdout, "write").mockImplementation(() => true);
		const steps = "- uses: conventional/determine-kind";
		await main({ ...env(steps), INPUT_TOKEN: "from-input" }, null);
		expect(process.env.GITHUB_TOKEN).toBe("from-input");

		vi.stubEnv("GITHUB_TOKEN", "own");
		await main(
			{ ...env(steps), INPUT_TOKEN: "from-input", GITHUB_TOKEN: "own" },
			null,
		);
		expect(process.env.GITHUB_TOKEN).toBe("own");
	});

	it("runs without an output file", async () => {
		const { GITHUB_OUTPUT: _, ...rest } = env(
			"- uses: conventional\n  with: { github/create-release: false }",
		);
		expect(await main(rest, null)).toBe(0);
		expect(await readFile(output, "utf8")).toBe("");
	});
});
