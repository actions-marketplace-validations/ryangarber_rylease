import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OptionsError } from "./options.ts";
import { resolveWorkflowSteps } from "./workflow.ts";

let cwd: string;

beforeAll(async () => {
	cwd = await mkdtemp(join(tmpdir(), "rylease-workflow-"));
	const rylease = JSON.stringify(join(import.meta.dirname, "index.ts"));
	await writeFile(
		join(cwd, "announce.ts"),
		`import { defineStep, definePreset, z } from ${rylease};

export const announce = defineStep({
	type: "release",
	name: "announce",
	options: { channel: z.string() },
	run: ({ options }) => ({ output: options.channel, reason: "announced" }),
});

export default announce;

export const both = definePreset({ name: "both", steps: [announce] });

export const notAStep = () => {};
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
	it("takes bundled steps and presets, by name or with options", async () => {
		expect(await names(["semver", { "conventional-kind": null }])).toEqual([
			"semver",
			"conventional-kind",
		]);
		expect(
			await names([
				{
					conventional: {
						"github-release": false,
						"read-git-tag": false,
						semver: { shiftPreMajor: false },
					},
				},
			]),
		).toEqual([
			"read-package-json",
			"conventional-commits",
			"conventional-kind",
			"semver",
			"conventional-notes",
			"write-package-json",
			"prepend-changelog",
			"git-commit",
		]);
	});

	it("loads steps and presets from files", async () => {
		const [step] = await resolveWorkflowSteps(
			[{ "./announce.ts": { channel: "#releases" } }],
			{ cwd },
		);
		expect(step?.name).toBe("announce");
		expect(
			await names([{ "./announce.ts#both": { announce: { channel: "x" } } }]),
		).toEqual(["announce"]);
	});

	it("reports problems with their path", async () => {
		expect(await problems({ semver: {} })).toEqual([
			"steps: expected a list of steps",
		]);
		expect(await problems([{ a: 1, b: 2 }])).toEqual([
			"steps[0]: expected a step name, or a map of one step name to its options",
		]);
		expect(await problems(["semver", { semver: { shift: true } }])).toEqual([
			'steps[1].semver: Unrecognized key: "shift"',
		]);
		expect(
			await problems([{ conventional: { semver: { shiftPreMajor: 1 } } }]),
		).toEqual([
			"steps[0].conventional.semver.shiftPreMajor: Invalid input: expected boolean, received number",
		]);
		expect(await problems([{ "./announce.ts": {} }])).toEqual([
			"steps[0].announce.channel: Invalid input: expected string, received undefined",
		]);
		expect(await problems(["nope"])).toEqual([
			expect.stringMatching(/^steps\[0\]\.nope: unknown step; use one of /),
		]);
		expect(await problems(["./announce.ts#notAStep"])).toEqual([
			`steps[0]["./announce.ts#notAStep"]: export 'notAStep' of ./announce.ts isn't a step made with defineStep or a preset made with definePreset`,
		]);
	});

	it("rejects a step that its preset already has", async () => {
		expect(
			await problems(["conventional", { "conventional-kind": {} }]),
		).toEqual([
			"steps[1].conventional-kind: 'conventional-kind' is already in 'conventional'; configure it there (conventional: { conventional-kind: ... }), or set it to false there to replace it",
		]);
		expect(
			await names([
				{ conventional: { "conventional-kind": false } },
				"conventional-kind",
			]),
		).toContain("conventional-kind");
	});
});
