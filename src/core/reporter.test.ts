import type { ComponentReport, ReleaseReport } from "./engine.ts";
import { defaultReporter, formatDuration, prettyReporter } from "./reporter.ts";
import type { Environment, StepRecord } from "./types.ts";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

const env: Environment = { cwd: "/p", branch: "main", dryRun: false };

const steps = [
	{ type: "previous", name: "git/tags" },
	{ type: "determine-kind", name: "kind" },
	{ type: "release", name: "a" },
] as const;

const root = { name: "root", path: ".", dependsOn: [], pathspec: [] };

const component = (
	overrides: Partial<ComponentReport> = {},
): ComponentReport => ({
	name: "root",
	path: ".",
	status: "released",
	dependencies: [],
	releases: [],
	previousVersion: "1.0.0",
	kind: "feature",
	version: "1.1.0",
	...overrides,
});

const report = (
	overrides: Partial<ReleaseReport> = {},
	components = [component()],
): ReleaseReport => ({
	env,
	status: "released",
	records: [],
	releases: [],
	components,
	...overrides,
});

/** A reporter that collects its output, uncolored unless asked. */
function capture(color = false) {
	let output = "";
	const reporter = prettyReporter({
		write: (text) => {
			output += text;
		},
		color,
	});
	return { reporter, output: () => output };
}

describe("prettyReporter", () => {
	it("prints a header, then a row per step with aligned columns", () => {
		const { reporter, output } = capture();
		reporter.start?.(env, steps, [root]);
		const records: StepRecord[] = [
			{
				type: "previous",
				name: "git/tags",
				status: "ok",
				durationMs: 4.2,
				reason: "v1.0.0 at abc1234",
			},
			{
				type: "determine-kind",
				name: "kind",
				status: "ok",
				durationMs: 0.3,
				reason: "'feat' in title",
			},
			{
				type: "release",
				name: "a",
				status: "skipped",
				durationMs: 0,
				reason: "`dryRun` is false",
			},
			{
				type: "release",
				name: "a",
				status: "failed",
				durationMs: 1234,
				reason: "boom",
			},
		];
		for (const record of records) reporter.step?.(record);
		expect(output().split("\n")).toEqual([
			"",
			"rylease release · main · /p",
			"",
			"  ✔ previous        git/tags      4ms  v1.0.0 at abc1234",
			"  ✔ determine-kind  kind         <1ms  'feat' in title",
			"  ○ release         a               -  `dryRun` is false",
			"  ✖ release         a           1.23s  boom",
			"",
		]);
	});

	it.each([
		[report(), "1.0.0 → 1.1.0 (feature) · released"],
		[
			report({ env: { ...env, dryRun: true } }),
			"1.0.0 → 1.1.0 (feature) · would release",
		],
		// A given release may not say what it was released from.
		[report({}, [component({ previousVersion: "1.1.0" })]), "1.1.0 · released"],
		[
			report({}, [(({ previousVersion: _, ...rest }) => rest)(component())]),
			"nothing → 1.1.0 (feature) · released",
		],
		[
			report({ status: "unchanged" }, [
				component({ status: "unchanged", kind: "none" }),
			]),
			"1.0.0 · nothing to release",
		],
		[report({ status: "failed" }), "release failed"],
		[
			report({ status: "pending", deferred: "released when #12 merges" }, [
				component({ status: "pending" }),
			]),
			"1.0.0 → 1.1.0 (feature) · proposed\n  released when #12 merges",
		],
		[
			report({}, [
				component({ name: "core" }),
				component({ name: "cli-tool", status: "unchanged", kind: "none" }),
			]),
			"core      1.0.0 → 1.1.0 (feature) · released\n  cli-tool  1.0.0 · nothing to release",
		],
	])("sums up %#", (result, summary) => {
		const { reporter, output } = capture();
		reporter.start?.(result.env, [], []);
		const header = output().length;
		reporter.finish?.(result);
		expect(output().slice(header)).toBe(`\n  ${summary}\n\n`);
	});

	it("names the component of each row when there are several", () => {
		const { reporter, output } = capture();
		reporter.start?.(env, steps, [
			{ ...root, name: "core" },
			{ ...root, name: "cli" },
		]);
		reporter.step?.({
			type: "release",
			name: "a",
			component: "cli",
			status: "ok",
			durationMs: 2,
			reason: "ran",
		});
		reporter.step?.({
			type: "release",
			name: "a",
			status: "ok",
			durationMs: 2,
			reason: "ran for all",
		});
		expect(output().split("\n").slice(3, 5)).toEqual([
			"  ✔ cli   release         a             2ms  ran",
			"  ✔ *     release         a             2ms  ran for all",
		]);
	});

	it("says it's a dry run up front", () => {
		const { reporter, output } = capture();
		reporter.start?.({ ...env, dryRun: true }, [], []);
		expect(output()).toBe("\nrylease dry run · main · /p\n\n");
	});

	it("colors when asked", () => {
		const { reporter, output } = capture(true);
		reporter.start?.({ ...env, dryRun: true }, [], []);
		expect(output()).toBe(
			"\n\x1b[1mrylease\x1b[22m \x1b[33mdry run\x1b[39m \x1b[2m·\x1b[22m \x1b[36mmain\x1b[39m \x1b[2m· /p\x1b[22m\n\n",
		);
	});

	it("colors with FORCE_COLOR, and writes to stdout by default", () => {
		const write = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);
		vi.stubEnv("FORCE_COLOR", "1");
		prettyReporter().start?.(env, [], []);
		vi.stubEnv("FORCE_COLOR", undefined);
		vi.stubEnv("NO_COLOR", "1");
		defaultReporter().start?.(env, [], []);
		expect(write.mock.calls.map(([text]) => text)).toEqual([
			expect.stringContaining("\x1b[1mrylease\x1b[22m"),
			"\nrylease release · main · /p\n\n",
		]);
	});
});

describe("formatDuration", () => {
	it.each([
		[0, "<1ms"],
		[0.99, "<1ms"],
		[1, "1ms"],
		[12.6, "13ms"],
		[999.4, "999ms"],
		[1000, "1.00s"],
		[61_234, "61.23s"],
	])("%d → %s", (ms, text) => {
		expect(formatDuration(ms)).toBe(text);
	});
});
