import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OptionsError } from "../core/options.ts";
import { resolveWorkflow, resolveWorkflowSteps } from "./workflow.ts";

let cwd: string;

beforeAll(async () => {
	cwd = await mkdtemp(join(tmpdir(), "rylease-workflow-"));
	const rylease = JSON.stringify(join(import.meta.dirname, "..", "index.ts"));
	await writeFile(
		join(cwd, "announce.ts"),
		`import { defineStep, definePreset, z } from ${rylease};

export const announce = defineStep({
	phase: "release",
	name: "announce",
	options: { channel: z.string() },
	run: ({ options }) => ({ output: options.channel, reason: "announced" }),
});

export default announce;

export const both = definePreset({ name: "both", steps: [announce] });

export const notAStep = () => {};
`,
	);
	// An installed package of steps, made without rylease itself.
	const pkg = join(cwd, "node_modules", "fake-steps");
	await mkdir(pkg, { recursive: true });
	await writeFile(
		join(pkg, "package.json"),
		JSON.stringify({ name: "fake-steps", type: "module", main: "index.js" }),
	);
	await writeFile(
		join(pkg, "index.js"),
		`const factory = (name) =>
	Object.defineProperties(
		() => ({ phase: "release", name, run: () => ({ output: null, reason: name }) }),
		{
			kind: { value: "step" },
			phase: { value: "release" },
			name: { value: name },
			options: { value: {} },
		},
	);
export default factory("fake");
export const other = factory("fake-other");
`,
	);
});

afterAll(async () => {
	await rm(cwd, { recursive: true, force: true });
});

const names = async (entries: unknown) =>
	(await resolveWorkflowSteps(entries, { cwd })).map((step) => step.name);

async function problems(entries: unknown): Promise<readonly string[]> {
	const error = await resolveWorkflowSteps(entries, { cwd }).catch(
		(e: unknown) => e,
	);
	expect(error).toBeInstanceOf(OptionsError);
	return (error as OptionsError).issues;
}

describe("resolveWorkflowSteps", () => {
	it("takes bundled steps and presets, with options", async () => {
		expect(
			await names([
				{ uses: "conventional/build-notes" },
				{ uses: "conventional/determine-kind", with: null },
			]),
		).toEqual(["conventional/build-notes", "conventional/determine-kind"]);
		expect(
			await names([
				{
					uses: "conventional",
					with: {
						"github/create-release": false,
						"conventional/build-notes": { links: false },
					},
				},
			]),
		).toEqual([
			"conventional/read-commits",
			"conventional/determine-kind",
			"conventional/build-notes",
			"git/create-tag",
		]);
	});

	it("loads steps and presets from files", async () => {
		const [step] = await resolveWorkflowSteps(
			[{ uses: "./announce.ts", with: { channel: "#releases" } }],
			{ cwd },
		);
		expect(step?.name).toBe("announce");
		expect(
			await names([
				{ uses: "./announce.ts#both", with: { announce: { channel: "x" } } },
			]),
		).toEqual(["announce"]);
	});

	it("loads steps from installed packages", async () => {
		expect(
			await names([{ uses: "fake-steps" }, { uses: "fake-steps#other" }]),
		).toEqual(["fake", "fake-other"]);
		expect(await problems([{ uses: "fake-steps#nope" }])).toEqual([
			"steps[0].uses: export 'nope' of fake-steps isn't made with defineStep, definePreset, defineScheme, defineHistory or defineComponents",
		]);
	});

	it("makes steps, and every step of a preset, conditional", async () => {
		const [step] = await resolveWorkflowSteps(
			[
				{
					uses: "conventional/build-notes",
					if: "!dryRun && startsWith(branch, 'release/')",
				},
			],
			{ cwd },
		);
		const input = (dryRun: boolean, branch: string) =>
			({
				env: { cwd, branch, dryRun },
				history: [],
				context: undefined,
			}) as never;
		expect(step?.if?.source).toBe("!dryRun && startsWith(branch, 'release/')");
		expect(step?.if?.(input(false, "release/2"))).toBe(true);
		expect(step?.if?.(input(true, "release/2"))).toBe(false);
		expect(step?.if?.(input(false, "main"))).toBe(false);

		const preset = await resolveWorkflowSteps(
			[{ uses: "conventional", if: false }],
			{ cwd },
		);
		expect(preset.map((s) => s.if?.(input(false, "main")))).toEqual(
			preset.map(() => false),
		);
	});

	it("reports problems with their path", async () => {
		expect(await problems({ "conventional/build-notes": {} })).toEqual([
			"steps: expected a list of steps",
		]);
		expect(await problems(["conventional/build-notes"])).toEqual([
			"steps[0]: expected a map with 'uses', and optionally 'with' and 'if'",
		]);
		expect(await problems([{ "conventional/build-notes": {} }])).toEqual([
			"steps[0].conventional/build-notes: unknown key; use uses, with, if",
		]);
		expect(await problems([{ uses: "semver" }])).toEqual([
			"steps[0].uses: 'semver' is a scheme, not a step; set it as `scheme` instead",
		]);
		expect(
			await problems([{ uses: "conventional/build-notes", with: [] }]),
		).toEqual(["steps[0].with: expected a map of options"]);
		expect(
			await problems([
				{ uses: "conventional/build-notes" },
				{ uses: "conventional/build-notes", with: { shift: true } },
			]),
		).toEqual(['steps[1].with: Unrecognized key: "shift"']);
		expect(
			await problems([
				{
					uses: "conventional",
					with: { "conventional/build-notes": { links: 1 } },
				},
			]),
		).toEqual([
			"steps[0].with.conventional/build-notes.links: Invalid input: expected boolean, received number",
		]);
		expect(
			await problems([{ uses: "conventional", with: { nope: false } }]),
		).toEqual([
			"steps[0].with: 'nope' isn't one of its steps (conventional/read-commits, conventional/determine-kind, conventional/build-notes, git/create-tag, github/create-release)",
		]);
		expect(await problems([{ uses: "./announce.ts" }])).toEqual([
			"steps[0].with.channel: Invalid input: expected string, received undefined",
		]);
		expect(await problems([{ uses: "nope" }])).toEqual([
			expect.stringMatching(/^steps\[0\]\.uses: unknown step/),
		]);
		expect(await problems([{ uses: "./announce.ts#notAStep" }])).toEqual([
			"steps[0].uses: export 'notAStep' of ./announce.ts isn't made with defineStep, definePreset, defineScheme, defineHistory or defineComponents",
		]);
		expect(
			await problems([{ uses: "conventional/build-notes", if: "version ==" }]),
		).toEqual(["steps[0].if: unexpected end in `version ==`"]);
		expect(
			await problems([{ uses: "conventional/build-notes", if: 1 }]),
		).toEqual(["steps[0].if: expected an expression or a boolean"]);
		expect(await problems([{ uses: "" }])).toEqual([
			"steps[0].uses: expected the name of a step or preset",
		]);
		expect(
			await problems([{ uses: "conventional/build-notes", if: "github.ref" }]),
		).toEqual([
			expect.stringMatching(
				/^steps\[0\]\.if: unknown name 'github'; use dryRun, .+ in `github\.ref`$/,
			),
		]);
	});

	it("rejects a step that its preset already has", async () => {
		expect(
			await problems([
				{ uses: "conventional" },
				{ uses: "conventional/determine-kind" },
			]),
		).toEqual([
			"steps[1].uses: 'conventional/determine-kind' is already in 'conventional'; configure it there (with: { conventional/determine-kind: ... }), or set it to false there to replace it",
		]);
		expect(
			await names([
				{
					uses: "conventional",
					with: { "conventional/determine-kind": false },
				},
				{ uses: "conventional/determine-kind", if: "!dryRun" },
			]),
		).toContain("conventional/determine-kind");
	});
});

describe("resolveWorkflow", () => {
	it("makes schemes, histories and component sources by name or with options", async () => {
		const release = await resolveWorkflow(
			{
				steps: [{ uses: "conventional" }],
				scheme: { uses: "calver", with: { format: "YY.MINOR.MICRO" } },
				tag: "release-{version}",
				history: [
					"git/tags",
					{ uses: "fs/version-file", with: { format: "npm" } },
				],
				components: "npm/workspaces",
			},
			{ cwd },
		);
		expect(release.scheme?.name).toBe("calver YY.MINOR.MICRO");
		expect(release.tag).toBe("release-{version}");
		expect(
			(release.history as unknown as { name: string }[]).map(
				({ name }) => name,
			),
		).toEqual(["git/tags", "fs/version-file"]);
		expect((release.components as { name: string }).name).toBe(
			"npm/workspaces",
		);
	});

	it("takes components as a list", async () => {
		const release = await resolveWorkflow(
			{
				steps: [],
				components: [
					{ name: "core", path: "packages/core" },
					{
						name: "cli",
						path: "packages/cli",
						dependsOn: ["core"],
						scheme: "calver",
						tag: "cli-v{version}",
					},
				],
			},
			{ cwd },
		);
		expect(release.components).toEqual([
			{ name: "core", path: "packages/core" },
			{
				name: "cli",
				path: "packages/cli",
				tag: "cli-v{version}",
				dependsOn: ["core"],
				scheme: expect.objectContaining({ name: "calver YYYY.MM.MICRO" }),
			},
		]);
	});

	it("reports problems with their path", async () => {
		const problems = async (input: object) => {
			const error = await resolveWorkflow(
				{ steps: [], ...input },
				{ cwd },
			).catch((e: unknown) => e);
			expect(error).toBeInstanceOf(OptionsError);
			return (error as OptionsError).issues;
		};
		expect(await problems({ scheme: "conventional" })).toEqual([
			"scheme.uses: 'conventional' is a preset, not a scheme",
		]);
		expect(
			await problems({ scheme: { uses: "calver", with: { format: "x" } } }),
		).toEqual([
			"scheme.with.format: must be distinct tokens joined by '.', of YYYY, YY, 0Y, MM, 0M, WW, 0W, DD, 0D, MAJOR, MINOR, MICRO",
			"scheme.with.format: must have a date token, e.g. YYYY",
		]);
		expect(await problems({ history: [{ use: "git/tags" }] })).toEqual([
			"history[0].use: unknown key; use uses, with",
		]);
		expect(await problems({ components: [{ name: "a", dir: "." }] })).toEqual([
			"components[0].dir: unknown key; use name, path, dependsOn, tag, scheme, history",
		]);
		expect(await problems({ tag: 1 })).toEqual([
			"tag: expected a template, e.g. v{version}",
		]);
	});
});
