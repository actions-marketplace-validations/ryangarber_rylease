import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { calver } from "../schemes/calver.ts";
import { semver } from "../schemes/semver.ts";
import { git } from "../utils/git.ts";
import type { Component } from "./components.ts";
import { defineRelease, defineStep } from "./define.ts";
import { ReleaseError, type ReleaseReport } from "./engine.ts";
import type { Found, History } from "./history.ts";
import type { Kind, Step, StepInput } from "./types.ts";

const options = { cwd: "/", branch: "main", reporter: null };

/** Finds each component's previous release at `versions[name]`, or 1.0.0. */
function fixed(versions: Record<string, string | undefined> = {}): History {
	return {
		name: "fixed",
		find: async ({ component }) => {
			const version =
				component.name in versions ? versions[component.name] : "1.0.0";
			return version === undefined
				? undefined
				: { version, ref: `ref-${component.name}`, reason: `found ${version}` };
		},
	};
}

function basics(kind: Kind = "feature"): Step[] {
	return [
		{
			phase: "read-changes",
			name: "fixed",
			run: () => ({
				changes: [{ title: "feat: x", reason: "test" }],
				reason: "1 change",
			}),
		},
		{
			phase: "determine-kind",
			name: "fixed",
			run: () => ({ kind, reason: `always ${kind}` }),
		},
		{
			phase: "build-notes",
			name: "fixed",
			run: () => ({ notes: "notes", reason: "hardcoded" }),
		},
	];
}

const release = (
	steps: readonly Step[],
	config: {
		components?: readonly Component[];
		tag?: string;
		history?: History | History[];
	} = {},
) => defineRelease({ steps, scheme: semver(), history: fixed(), ...config });

describe("runRelease", () => {
	it("runs steps by phase, chaining outputs of the same phase", async () => {
		const header = defineStep({
			phase: "build-notes",
			name: "header",
			run: ({ tag, notes }) => ({
				notes: `# ${tag}\n\n${notes}`,
				reason: "prepended header",
			}),
		});
		const seen: unknown[] = [];
		const publish = (name: string): Step => ({
			phase: "release",
			name,
			run: ({ notes, releases }) => {
				seen.push({ notes, releases });
				return { output: name.toUpperCase(), reason: `published ${name}` };
			},
		});
		// Deliberately out of order: release steps first, header last.
		const report = await release([
			publish("a"),
			publish("b"),
			...basics(),
			header(),
		]).run(options);

		expect(
			report.records.map((r) => `${r.phase}:${r.name}: ${r.reason}`),
		).toEqual([
			"read-version:fixed: found 1.0.0",
			"read-changes:fixed: 1 change",
			"determine-kind:fixed: always feature",
			"determine-version:semver: 1.1.0: 'feature' from 1.0.0, bumps minor",
			"build-notes:fixed: hardcoded",
			"build-notes:header: prepended header",
			"release:a: published a",
			"release:b: published b",
		]);
		expect(seen).toEqual([
			{ notes: "# v1.1.0\n\nnotes", releases: [] },
			{
				notes: "# v1.1.0\n\nnotes",
				releases: [{ name: "a", output: "A", files: [] }],
			},
		]);
		expect(report).toMatchObject({
			status: "released",
			previousVersion: "1.0.0",
			previousRef: "ref-root",
			kind: "feature",
			version: "1.1.0",
			notes: "# v1.1.0\n\nnotes",
			releases: [
				{ name: "a", output: "A", files: [] },
				{ name: "b", output: "B", files: [] },
			],
			components: [
				{
					name: "root",
					path: ".",
					status: "released",
					version: "1.1.0",
					tag: "v1.1.0",
				},
			],
		});
	});

	it("gives steps the component, the release's tag and its placeholders", async () => {
		let received: unknown;
		await release([
			...basics("breaking"),
			{
				phase: "release",
				name: "inspect",
				run: ({ component, previousTag, tag, placeholders }) => {
					received = { component, previousTag, tag, placeholders };
					return { output: null, reason: "inspected" };
				},
			},
		]).run(options);
		expect(received).toEqual({
			component: { name: "root", path: ".", dependsOn: [], pathspec: [] },
			previousTag: undefined,
			tag: "v2.0.0",
			placeholders: {
				version: "2.0.0",
				major: "2",
				minor: "0",
				patch: "0",
				tag: "v2.0.0",
				name: "root",
			},
		});
	});

	it("passes env, history and a mutable context", async () => {
		const run = defineRelease<{ calls: string[] }>({
			context: { calls: [] },
			scheme: semver(),
			history: fixed(),
			steps: [
				...basics(),
				{
					phase: "release",
					name: "inspect",
					run: ({ env, context, history }) => {
						context.calls.push("inspect");
						return {
							output: { env, steps: history.length, calls: context.calls },
							reason: "inspected",
						};
					},
				},
			],
		});
		const report = await run.run({ ...options, dryRun: true });
		expect(report.releases[0]?.output).toEqual({
			env: { cwd: "/", branch: "main", dryRun: true },
			steps: 5,
			calls: ["inspect"],
		});
	});

	it("skips steps whose condition is false", async () => {
		const ran: string[] = [];
		const step = (
			name: string,
			condition?: (input: StepInput<"release">) => boolean,
		): Step => ({
			phase: "release",
			name,
			...(condition && {
				if: Object.assign(condition, { source: `${name}?` }),
			}),
			run: () => {
				ran.push(name);
				return { output: name, reason: `ran ${name}` };
			},
		});
		const report = await release([
			...basics(),
			step("a"),
			step("b", () => false),
			step("c", ({ releases }) => releases.some((r) => r.name === "a")),
		]).run(options);
		expect(report.status).toBe("released");
		expect(ran).toEqual(["a", "c"]);
		expect(
			report.records.slice(-2).map((r) => `${r.status}: ${r.reason}`),
		).toEqual(["skipped: `b?` is false", "ok: ran c"]);
	});

	it("fails when conditions skip every step of a phase", async () => {
		const steps = basics().map((step) =>
			step.phase === "determine-kind" ? { ...step, if: () => false } : step,
		) as Step[];
		await expect(release(steps).run(options)).rejects.toThrow(
			"no 'determine-kind' step ran, so it has no kind",
		);
	});

	it("runs only release steps for a given release", async () => {
		const inputs: unknown[] = [];
		const report = await release([
			...basics(),
			{
				phase: "release",
				name: "upload",
				run: ({ env: _, context: __, history: ___, ...input }) => {
					inputs.push(input);
					return { output: null, reason: "uploaded" };
				},
			},
		]).run({ ...options, release: { version: "2.1.0", notes: "Notes." } });
		expect(report.status).toBe("released");
		expect(report.records.map((r) => `${r.status}: ${r.reason}`)).toEqual([
			...basics().map(() => "skipped: releasing the given 2.1.0"),
			"ok: uploaded",
		]);
		expect(inputs).toEqual([
			{
				component: { name: "root", path: ".", dependsOn: [], pathspec: [] },
				previousVersion: "2.1.0",
				changes: [],
				kind: "fix",
				version: "2.1.0",
				tag: "v2.1.0",
				placeholders: {
					version: "2.1.0",
					major: "2",
					minor: "1",
					patch: "0",
					tag: "v2.1.0",
					name: "root",
				},
				notes: "Notes.",
				dependencies: [],
				releases: [],
			},
		]);

		const feature = await release([]).run({
			...options,
			release: { version: "2.1.0", previousVersion: "2.0.3" },
		});
		expect(feature).toMatchObject({
			kind: "feature",
			notes: "",
			status: "released",
		});

		// Any scheme, or none at all.
		const kind = async (previousVersion: string, version: string) =>
			(
				await release([]).run({
					...options,
					release: { version, previousVersion },
				})
			).kind;
		expect(await kind("2025.12.4", "2026.1.0")).toBe("breaking");
		expect(await kind("24.04", "24.10")).toBe("feature");
		expect(await kind("nightly-1", "nightly-2")).toBe("fix");
	});

	it("stops after the kind phase when there is nothing to release", async () => {
		const report = await release(basics("none")).run(options);
		expect(report.status).toBe("unchanged");
		expect(report.records.map((r) => `${r.phase} ${r.status}`)).toEqual([
			"read-version ok",
			"read-changes ok",
			"determine-kind ok",
			"determine-version skipped",
			"build-notes skipped",
		]);
		expect(report.records.at(-1)?.reason).toBe("no release-worthy changes");
		expect(report.components[0]?.status).toBe("unchanged");
	});

	it("records failures and skips the remaining steps", async () => {
		const run = release([
			...basics(),
			{
				phase: "release",
				name: "boom",
				run: () => {
					throw new Error("kaboom");
				},
			},
			{
				phase: "release",
				name: "after",
				run: () => ({ output: null, reason: "unreachable" }),
			},
		]);
		const error = await run.run(options).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ReleaseError);
		const { report } = error as ReleaseError;
		expect(report.status).toBe("failed");
		expect(report.records.slice(-2)).toMatchObject([
			{ name: "boom", status: "failed", reason: "kaboom" },
			{
				name: "after",
				status: "skipped",
				reason: "'release' step 'boom' failed",
			},
		]);
	});

	it("rejects missing phases and malformed outputs", async () => {
		await expect(release(basics().slice(0, 1)).run(options)).rejects.toThrow(
			"no step provided for: determine-kind, build-notes",
		);

		const steps = basics();
		steps[1] = {
			...basics()[1],
			run: () => ({ kind: "major", reason: "x" }),
		} as unknown as Step;
		await expect(release(steps).run(options)).rejects.toThrow(
			"'kind' must be one of breaking, feature, fix, none",
		);
		const files = {
			phase: "release",
			name: "files",
			run: () => ({ output: null, files: "a", reason: "x" }),
		};
		await expect(
			release([...basics(), files as unknown as Step]).run(options),
		).rejects.toThrow("'files' must be an array of paths when present");
	});

	it("rejects other malformed outputs", async () => {
		const failure = async (index: number, output: unknown) => {
			const steps = basics();
			steps[index] = {
				...basics()[index],
				run: () => output,
			} as unknown as Step;
			const error = await release(steps)
				.run(options)
				.catch((e: unknown) => e);
			return (error as ReleaseError).report.records.find(
				(record) => record.status === "failed",
			)?.reason;
		};
		expect(await failure(0, null)).toBe("invalid output: expected an object");
		expect(await failure(0, { changes: [], reason: " " })).toBe(
			"invalid output: 'reason' must be a non-empty string",
		);
		expect(await failure(0, { changes: [{}], reason: "x" })).toBe(
			"invalid output: 'changes' must be an array of changes, each with a 'reason'",
		);
		expect(
			await failure(0, {
				changes: [{ reason: "x", labels: "bug" }],
				reason: "x",
			}),
		).toBe(
			"invalid output: a change's 'labels' must be an array of strings when present",
		);
		expect(await failure(1, { kind: "fix", version: 1, reason: "x" })).toBe(
			"invalid output: 'version' must be a non-empty string when present",
		);
		expect(await failure(2, { notes: 1, reason: "x" })).toBe(
			"invalid output: 'notes' must be a string",
		);
		const noOutput = {
			phase: "release",
			name: "x",
			run: () => ({ reason: "x" }),
		} as unknown as Step;
		await expect(release([...basics(), noOutput]).run(options)).rejects.toThrow(
			"'output' is required (use null for none)",
		);
	});

	it("reports progress to the reporter", async () => {
		const calls: string[] = [];
		const report = await release(basics()).run({
			...options,
			reporter: {
				start: (env, steps, components) =>
					calls.push(
						`start ${env.branch} ${steps.length} ${components.map((c) => c.name)}`,
					),
				step: (record) => calls.push(`${record.status} ${record.phase}`),
				finish: (result) => calls.push(`finish ${result.status}`),
			},
		});
		expect(calls).toEqual([
			"start main 5 root",
			"ok read-version",
			"ok read-changes",
			"ok determine-kind",
			"ok determine-version",
			"ok build-notes",
			"finish released",
		]);
		expect(report.records).toHaveLength(5);
	});

	it("reports failures before throwing them", async () => {
		const reports: ReleaseReport[] = [];
		const error = await release([])
			.run({ ...options, reporter: { finish: (r) => reports.push(r) } })
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ReleaseError);
		expect(reports).toEqual([(error as ReleaseError).report]);
		expect(reports[0]?.status).toBe("failed");
	});
});

describe("versions", () => {
	it("come from the scheme, from where the history found the last", async () => {
		const report = await defineRelease({
			steps: basics("feature"),
			scheme: calver({ format: "YY.MINOR.MICRO" }),
			history: fixed({ root: "26.2.5" }),
		}).run(options);
		const year = String(new Date().getUTCFullYear() - 2000);
		expect(report.version).toBe(year === "26" ? "26.3.0" : `${year}.0.0`);
		expect(report.records[3]?.name).toBe("calver YY.MINOR.MICRO");
	});

	it("start from the scheme's first without a previous release", async () => {
		const report = await release(basics(), {
			history: fixed({ root: undefined }),
		}).run(options);
		expect(report.records.map((r) => r.reason)).toEqual([
			"no previous release; every change counts",
			"1 change",
			"always feature",
			"0.1.0: 'feature', first release",
			"hardcoded",
		]);
		expect(report.previousVersion).toBeUndefined();
	});

	it("start over when the previous one isn't in the scheme", async () => {
		const report = await release(basics(), {
			history: fixed({ root: "2026.01.0" }),
		}).run(options);
		expect(report.records[0]?.reason).toBe(
			"found 2026.01.0; 2026.01.0 isn't semver, so this release is its first",
		);
		expect(report).toMatchObject({ previousRef: "ref-root", version: "0.1.0" });
	});

	it("take the first history that finds a release", async () => {
		const none: History = { name: "none", find: async () => undefined };
		const report = await release(basics(), { history: [none, fixed()] }).run(
			options,
		);
		expect(report.records[0]).toMatchObject({
			phase: "read-version",
			name: "fixed",
			reason: "found 1.0.0",
		});
	});

	it("can be set exactly by a determine-kind step, if they come after", async () => {
		const exact = (version: string): Step => ({
			phase: "determine-kind",
			name: "release-as",
			run: () => ({ kind: "breaking", version, reason: "Release-As" }),
		});
		const report = await release([...basics(), exact("3.0.0")]).run(options);
		expect(report.version).toBe("3.0.0");
		expect(report.records[4]?.reason).toBe(
			"3.0.0: 'breaking' from 1.0.0, as determined",
		);
		await expect(
			release([...basics(), exact("1.0.0")]).run(options),
		).rejects.toThrow("1.0.0 wouldn't come after 1.0.0");
		await expect(
			release([...basics(), exact("v3")]).run(options),
		).rejects.toThrow("v3 isn't a semver version");
	});
});

describe("facts", () => {
	const labeled = defineStep({
		phase: "determine-kind",
		name: "labeled",
		needs: ["changes.labels"],
		run: ({ changes }) => ({
			kind: changes.some((c) => c.labels.includes("feat")) ? "feature" : "fix",
			reason: "by labels",
		}),
	});
	const withLabels = defineStep({
		phase: "read-changes",
		name: "with-labels",
		provides: ["changes.labels"],
		run: () => ({
			changes: [{ reason: "pr", labels: ["feat"] }],
			reason: "1 pr",
		}),
	});

	it("are checked before anything runs, naming steps that provide them", async () => {
		const ran: string[] = [];
		const error = await release([
			{
				...basics()[0],
				run: (input: unknown) => {
					ran.push("read");
					return (basics()[0] as { run: (i: unknown) => unknown }).run(input);
				},
			} as Step,
			labeled(),
			basics()[2] as Step,
		])
			.run(options)
			.catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ReleaseError);
		expect((error as Error).message).toBe(
			"labeled needs changes.labels, which fixed doesn't provide; with-labels does",
		);
		expect(ran).toEqual([]);
	});

	it("hold when an earlier step provides them, and are checked on its output", async () => {
		const report = await release([
			withLabels(),
			labeled(),
			basics()[2] as Step,
		]).run(options);
		expect(report.kind).toBe("feature");

		const lying = defineStep({
			phase: "read-changes",
			name: "lying",
			provides: ["changes.labels"],
			run: () => ({ changes: [{ reason: "pr" }], reason: "1 pr" }) as never,
		});
		await expect(
			release([lying(), labeled(), basics()[2] as Step]).run(options),
		).rejects.toThrow(
			"invalid output: it provides changes.labels, but change 0 (pr) has no 'labels'",
		);
	});

	it("about changes no longer hold once other changes replace them", async () => {
		await expect(
			release([
				withLabels(),
				basics()[0] as Step,
				labeled(),
				basics()[2] as Step,
			]).run(options),
		).rejects.toThrow(
			"labeled needs changes.labels, which fixed doesn't provide",
		);
	});

	it("are checked again when conditions skip their providers", async () => {
		const skipped = { ...withLabels(), if: () => false } as Step;
		await expect(
			release([
				basics()[0] as Step,
				skipped,
				labeled(),
				basics()[2] as Step,
			]).run(options),
		).rejects.toThrow(
			"determine-kind step 'labeled' failed: it needs changes.labels, which no step that ran provides",
		);
	});

	it("include the scheme's traits", async () => {
		const npm = defineStep({
			phase: "release",
			name: "npm-like",
			needs: ["version.semver"],
			run: () => ({ output: null, reason: "ok" }),
		});
		expect((await release([...basics(), npm()]).run(options)).status).toBe(
			"released",
		);
		await expect(
			defineRelease({
				steps: [...basics(), npm()],
				scheme: calver({ format: "YYYY.0M.MICRO" }),
				history: fixed(),
			}).run(options),
		).rejects.toThrow(
			"npm-like needs version.semver, which the scheme calver YYYY.0M.MICRO doesn't provide",
		);
	});
});

describe("components", () => {
	const core = { name: "core", path: "packages/core" };
	const cli = { name: "cli", path: "packages/cli", dependsOn: ["core"] };
	const kinds = (byName: Record<string, Kind>): Step => ({
		phase: "determine-kind",
		name: "kinds",
		run: ({ component }) => ({
			kind: byName[component.name] ?? "none",
			reason: `${component.name}'s`,
		}),
	});

	it("run each step for every component, dependencies first", async () => {
		const seen: string[] = [];
		const report = await release(
			[
				basics()[0] as Step,
				kinds({ core: "fix", cli: "feature" }),
				basics()[2] as Step,
				{
					phase: "release",
					name: "each",
					run: ({ component, tag }) => {
						seen.push(`${component.name} ${tag}`);
						return { output: null, reason: "ok" };
					},
				},
			],
			{ components: [cli, core] },
		).run(options);
		expect(seen).toEqual(["core core@1.0.1", "cli cli@1.1.0"]);
		expect(
			report.records.map((r) => `${r.component ?? "*"} ${r.phase} ${r.name}`),
		).toEqual([
			"core read-version fixed",
			"cli read-version fixed",
			"core read-changes fixed",
			"cli read-changes fixed",
			"core determine-kind kinds",
			"cli determine-kind kinds",
			"core determine-version semver",
			"cli determine-version semver",
			"core build-notes fixed",
			"cli build-notes fixed",
			"core release each",
			"cli release each",
		]);
		expect(report.components.map((c) => [c.name, c.status, c.version])).toEqual(
			[
				["core", "released", "1.0.1"],
				["cli", "released", "1.1.0"],
			],
		);
		// With several components, there's no single version.
		expect(report.version).toBeUndefined();
	});

	it("drop out once there's nothing to release for them", async () => {
		const seen: string[] = [];
		const report = await release(
			[
				...basics().filter((step) => step.phase !== "determine-kind"),
				kinds({ cli: "fix" }),
				{
					phase: "release",
					name: "all",
					scope: "all",
					run: ({ components }) => {
						seen.push(...components.map(({ component }) => component.name));
						return { output: null, files: ["x"], reason: "ok" };
					},
				},
			],
			{ components: [core, cli] },
		).run(options);
		expect(seen).toEqual(["cli"]);
		expect(report.status).toBe("released");
		expect(report.components.map((c) => c.status)).toEqual([
			"unchanged",
			"released",
		]);
		expect(report.components[1]?.releases).toEqual([
			{ name: "all", output: null, files: ["x"] },
		]);
	});

	it("are given to `all` steps together, which may change any of them", async () => {
		const raise: Step = {
			phase: "determine-kind",
			name: "raise",
			scope: "all",
			run: ({ components }) => ({
				results: Object.fromEntries(
					components
						.filter(({ kind }) => kind === "none")
						.map(({ component }) => [
							component.name,
							{ kind: "fix", reason: "raised" },
						]),
				),
				reason: "raised the rest",
			}),
		};
		const report = await release(
			[
				...basics().filter((s) => s.phase !== "determine-kind"),
				kinds({ core: "breaking" }),
				raise,
			],
			{ components: [core, cli] },
		).run(options);
		expect(report.components.map((c) => c.version)).toEqual(["2.0.0", "1.0.1"]);
		expect(report.records.find((r) => r.name === "raise")).toMatchObject({
			status: "ok",
			reason: "raised the rest",
		});
		expect(
			report.records.find((r) => r.name === "raise")?.component,
		).toBeUndefined();

		const stray: Step = {
			...raise,
			run: () => ({
				results: { nope: { kind: "fix", reason: "x" } },
				reason: "x",
			}),
		} as Step;
		await expect(
			release([...basics(), stray], { components: [core, cli] }).run(options),
		).rejects.toThrow(
			"invalid output: 'nope' isn't a component being released",
		);
	});

	it("scope changes to their paths, without nested components", async () => {
		let received: unknown;
		await release(
			[
				{
					phase: "read-changes",
					name: "paths",
					run: ({ component }) => {
						received = {
							...(received as object),
							[component.name]: component.pathspec,
						};
						return { changes: [], reason: "none" };
					},
				},
				...basics().slice(1),
			],
			{ components: [{ name: "app", path: "." }, core] },
		).run(options);
		expect(received).toEqual({
			app: [".", ":(exclude)packages/core"],
			core: ["packages/core"],
		});
	});

	it("are checked before anything runs", async () => {
		const problem = (components: Component[], tag?: string) =>
			release(basics(), { components, ...(tag && { tag }) })
				.run(options)
				.catch((e: ReleaseError) => e.message.split("\n")[0]);
		expect(await problem([core, { name: "core" }])).toBe(
			"components[1].name: 'core' is listed twice",
		);
		expect(await problem([core, { name: "x", path: "../x" }])).toBe(
			"components[1].path: '../x' must be inside the project",
		);
		expect(await problem([{ ...core, dependsOn: ["nope"] }])).toBe(
			"components[0].dependsOn: 'nope' isn't a component",
		);
		expect(await problem([core], "v{major}")).toBe(
			"tag: 'v{major}' has no {version} placeholder",
		);
		expect(await problem([{ ...core, tag: "{version}-{date}" }])).toBe(
			"components[0].tag: unknown placeholder {date} in '{version}-{date}'; use {version} or {name}",
		);
		expect(await problem([core, cli], "v{version}")).toBe(
			"components: 'core' and 'cli' share the tag 'v{version}'; add {name} to it",
		);
		expect(
			await problem([
				{ ...core, dependsOn: ["cli"] },
				{ ...cli, dependsOn: ["core"] },
			]),
		).toBe("components: core, cli depend on each other in a cycle");
	});

	it("take a given release for one of them", async () => {
		const report = await release([], { components: [core, cli] }).run({
			...options,
			release: { version: "2.0.0", component: "cli" },
		});
		expect(report.components.map((c) => [c.name, c.status])).toEqual([
			["core", "unchanged"],
			["cli", "released"],
		]);
		await expect(
			release([], { components: [core, cli] }).run({
				...options,
				release: { version: "2.0.0" },
			}),
		).rejects.toThrow(
			"there are several components (core, cli); say which the given release is for",
		);
	});

	it("can each have their own scheme and tag", async () => {
		const report = await defineRelease({
			steps: basics("fix"),
			scheme: semver(),
			history: fixed({ core: "1.0.0", cli: undefined }),
			components: [
				core,
				{ ...cli, scheme: semver({ initial: "1.0.0" }), tag: "cli-{version}" },
			],
		}).run(options);
		expect(report.components.map((c) => c.tag)).toEqual([
			"core@1.0.1",
			"cli-1.0.0",
		]);
	});
});

describe("write and release", () => {
	const write = (name: string, extra: object = {}): Step => ({
		phase: "write",
		name,
		run: () => ({
			output: name,
			files: [`${name}.txt`],
			reason: `wrote ${name}`,
			...extra,
		}),
	});
	const ship: Step = {
		phase: "release",
		name: "ship",
		run: ({ releases }) => ({
			output: releases.flatMap((r) => r.files),
			reason: "shipped",
		}),
	};

	it("writes before releasing, whatever the order they're listed in", async () => {
		const report = await release([
			ship,
			write("a"),
			...basics(),
			write("b"),
		]).run(options);
		expect(report.records.slice(-3).map((r) => `${r.phase} ${r.name}`)).toEqual(
			["write a", "write b", "release ship"],
		);
		expect(report.releases.at(-1)?.output).toEqual(["a.txt", "b.txt"]);
	});

	it("leaves the release to later when a write step defers it", async () => {
		const report = await release([
			...basics(),
			write("pr", { defer: "released when #12 merges" }),
			ship,
		]).run(options);
		expect(report.status).toBe("pending");
		expect(report.deferred).toBe("released when #12 merges");
		expect(report.components[0]?.status).toBe("pending");
		expect(report.records.at(-1)).toMatchObject({
			name: "ship",
			status: "skipped",
			reason: "released when #12 merges",
		});
	});

	it("runs only release steps for a given release, write steps included", async () => {
		const report = await release([...basics(), write("a"), ship]).run({
			...options,
			release: { version: "2.0.0" },
		});
		expect(report.records.map((r) => `${r.name} ${r.status}`)).toEqual([
			"fixed skipped",
			"fixed skipped",
			"fixed skipped",
			"a skipped",
			"ship ok",
		]);
	});

	it("takes given releases for several components", async () => {
		const report = await release([ship], {
			components: [
				{ name: "a" },
				{ name: "b", path: "b" },
				{ name: "c", path: "c" },
			],
		}).run({
			...options,
			release: [
				{ version: "1.1.0", component: "a" },
				{ version: "2.0.0", component: "c" },
			],
		});
		expect(report.components.map((c) => [c.name, c.status, c.tag])).toEqual([
			["a", "released", "a@1.1.0"],
			["b", "unchanged", undefined],
			["c", "released", "c@2.0.0"],
		]);
	});

	it("releases what a history finds prepared, and nothing else", async () => {
		const history: History = {
			name: "prepared",
			find: async ({ component }) =>
				component.name === "a"
					? {
							version: "1.0.0",
							reason: "#12 merged",
							pending: {
								version: "1.1.0",
								notes: "Notes.",
								kind: "feature",
								reason: "prepared in #12",
							},
						}
					: { version: "3.0.0", reason: "v3.0.0" },
		};
		const report = await release([...basics(), write("a"), ship], {
			components: [{ name: "a" }, { name: "b", path: "b" }],
			history,
		}).run(options);
		expect(report.status).toBe("released");
		expect(
			report.components.map((c) => [c.name, c.status, c.version, c.notes]),
		).toEqual([
			["a", "released", "1.1.0", "Notes."],
			["b", "unchanged", undefined, undefined],
		]);
		expect(report.records.find((r) => r.name === "a")).toMatchObject({
			status: "skipped",
			reason: "releasing 1.1.0, prepared in #12",
		});
	});
});

describe("channels", () => {
	const at = (
		found: Found | undefined,
		count = 0,
		existing: string[] = [],
	): History => ({
		name: "tags",
		find: async () => found,
		count: async () => count,
		exists: async ({ releaseTag }) => existing.includes(releaseTag),
	});
	const channels = {
		next: { branches: ["next"] },
		nightly: { type: "build" as const },
	};
	const run = (
		history: History,
		kind: Kind,
		branch = "next",
		channel?: string,
	) =>
		defineRelease({
			steps: basics(kind),
			scheme: semver(),
			history,
			channels,
		}).run({
			...options,
			branch,
			...(channel && { channel }),
		});

	it("make prereleases of the next version on a branch's channel", async () => {
		const report = await run(
			at({ version: "1.4.0", reason: "v1.4.0" }),
			"breaking",
		);
		expect(report.version).toBe("2.0.0-next.1");
		expect(report.env.channel).toEqual({ name: "next", type: "prerelease" });
		expect(report.records[3]?.reason).toBe(
			"2.0.0-next.1: 'breaking' from 1.4.0, bumps major, next 1",
		);
	});

	it("keep the target their prereleases lead up to, counting on", async () => {
		const previous = {
			version: "2.0.0-next.2",
			reason: "v2.0.0-next.2",
			stable: { version: "1.4.0" },
		};
		expect((await run(at(previous, 2), "fix")).version).toBe("2.0.0-next.3");
		// Counted across every branch.
		expect((await run(at(previous, 5), "feature")).version).toBe(
			"2.0.0-next.6",
		);
		// A bigger change moves the target, and starts counting again.
		const ahead = { ...previous, version: "1.5.0-next.2" };
		expect((await run(at(ahead, 0), "breaking")).version).toBe("2.0.0-next.1");
	});

	it("number builds of the previous release", async () => {
		const report = await run(
			at(
				{
					version: "1.4.0+nightly.2",
					reason: "x",
					stable: { version: "1.4.0" },
				},
				2,
			),
			"feature",
			"main",
			"nightly",
		);
		expect(report.version).toBe("1.4.0+nightly.3");
		await expect(run(at(undefined), "fix", "main", "nightly")).rejects.toThrow(
			"a build on 'nightly' needs a previous release to number builds of",
		);
	});

	it("give steps the channel, and placeholders of the target", async () => {
		let received: unknown;
		await defineRelease({
			steps: [
				...basics("breaking"),
				{
					phase: "release",
					name: "inspect",
					run: ({ env, placeholders }) => {
						received = { channel: env.channel, placeholders };
						return { output: null, reason: "ok" };
					},
				},
			],
			scheme: semver(),
			history: at({ version: "1.4.0", reason: "x" }),
			channels,
		}).run({ ...options, branch: "next" });
		expect(received).toEqual({
			channel: { name: "next", type: "prerelease" },
			placeholders: {
				version: "2.0.0-next.1",
				major: "2",
				minor: "0",
				patch: "0",
				tag: "v2.0.0-next.1",
				name: "root",
				channel: "next",
			},
		});
	});

	it("refuse a version whose tag exists already", async () => {
		await expect(
			run(
				at({ version: "1.4.0", reason: "x" }, 0, ["v2.0.0-next.1"]),
				"breaking",
			),
		).rejects.toThrow(
			"v2.0.0-next.1 already exists; it was released from another branch",
		);
	});

	it("are checked before anything runs", async () => {
		await expect(
			defineRelease({
				steps: basics(),
				scheme: semver(),
				history: at(undefined),
				channels: { "a b": {} },
			}).run(options),
		).rejects.toThrow(
			"channels.a b: names may only have letters, digits and '-'",
		);
		await expect(
			defineRelease({
				steps: basics(),
				scheme: semver(),
				history: at(undefined),
				channels,
			}).run({
				...options,
				channel: "rc",
			}),
		).rejects.toThrow("channel: 'rc' isn't a channel; use next, nightly");
	});
});

describe("branch", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	const branchOf = async (cwd = "/") =>
		(
			await release(basics()).run({
				cwd,
				reporter: null,
			})
		).env.branch;

	it("comes from CI, preferring a pull request's head", async () => {
		vi.stubEnv("GITHUB_HEAD_REF", "feature");
		vi.stubEnv("GITHUB_REF_NAME", "42/merge");
		expect(await branchOf()).toBe("feature");
		vi.stubEnv("GITHUB_HEAD_REF", "");
		expect(await branchOf()).toBe("42/merge");
	});

	it("comes from git outside CI", async () => {
		vi.stubEnv("GITHUB_HEAD_REF", "");
		vi.stubEnv("GITHUB_REF_NAME", "");
		const cwd = await mkdtemp(join(tmpdir(), "rylease-"));
		try {
			expect(await branchOf(cwd)).toBe("unknown");
			await git(cwd, "init", "-q", "-b", "trunk");
			await git(
				cwd,
				"-c",
				"user.name=t",
				"-c",
				"user.email=t@e",
				"commit",
				"-q",
				"--allow-empty",
				"-m",
				"init",
			);
			expect(await branchOf(cwd)).toBe("trunk");
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
