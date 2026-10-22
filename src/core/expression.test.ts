import {
	compileExpression,
	type ExpressionContext,
	expressionContext,
} from "./expression.ts";

const context: ExpressionContext = {
	dryRun: false,
	branch: "release/2",
	cwd: "/",
	channel: null,
	prerelease: false,
	previousVersion: "1.4.0",
	kind: "minor",
	version: "1.5.0",
	changes: [{ reason: "commit a" }],
	steps: {
		"github/create-release": { status: "ok", output: { url: "https://x/1" } },
		"version/bump-semver": { status: "skipped" },
		announce: { status: "ok", output: "#releases" },
	},
};

const evaluate = (source: string) => compileExpression(source)(context);

describe("compileExpression", () => {
	it.each([
		["true", true],
		["null", null],
		["'it''s'", "it's"],
		["1.5", 1.5],
		["dryRun", false],
		["!dryRun", true],
		["kind == 'minor'", true],
		["kind != 'minor' || version", "1.5.0"],
		["dryRun && version", false],
		["notes == null", true],
		["!(kind == 'major') && version >= '1.5.0'", true],
		["changes[0].reason", "commit a"],
		["steps['github/create-release'].output.url", "https://x/1"],
		["steps['version/bump-semver'].status == 'skipped'", true],
		["steps.announce.output", "#releases"],
		["steps.missing.status", undefined],
		["steps['toString']", undefined],
		["version.length", undefined],
		["startsWith(branch, 'release/') && endsWith(version, '.0')", true],
		["contains(branch, 'lease') && !contains(changes, 'x')", true],
		["1 < 2 && 'b' > 'a' && 1 < 'b'", false],
	])("%s → %o", (source, value) => {
		expect(evaluate(source)).toEqual(value);
	});

	it.each([
		["", "empty expression"],
		["kind ==", "unexpected end"],
		["kind = 'x'", "unexpected '=' at 6"],
		["(dryRun", "unexpected end"],
		["dryRun dryRun", "unexpected 'dryRun'"],
		["github.ref", "unknown name 'github'"],
		["format('x')", "unknown function 'format'"],
		["steps.)", "unexpected ')'"],
		["contains(notes, )", "unexpected ')'"],
		[
			"steps.git/commit.output",
			"unexpected '/' at 10; read names with '/' as steps['git/commit']",
		],
	])("rejects %o", (source, message) => {
		expect(() => compileExpression(source)).toThrow(message);
	});
});

describe("expressionContext", () => {
	const record = (component?: string) => ({
		phase: "release" as const,
		name: "github/create-release",
		...(component && { component }),
		status: "ok" as const,
		durationMs: 1,
		reason: `created ${component}`,
		output: { output: { url: component }, reason: "created" },
	});
	const values = (name: string) => ({
		component: { name, path: `packages/${name}`, dependsOn: [], pathspec: [] },
		previousVersion: "1.0.0",
		changes: [],
		kind: "fix",
		version: "1.0.1",
		tag: `${name}@1.0.1`,
		placeholders: {},
		notes: "n",
		releases: [],
	});
	const shared = {
		env: { cwd: "/p", branch: "main", dryRun: true },
		context: undefined,
		history: [
			{ ...record(), phase: "read-version" as const, name: "git/tags" },
			record("core"),
			record("cli"),
		],
	};

	it("reads what the step would receive, and its component's steps", () => {
		expect(expressionContext({ ...values("cli"), ...shared })).toEqual({
			dryRun: true,
			branch: "main",
			cwd: "/p",
			channel: null,
			prerelease: false,
			component: { name: "cli", path: "packages/cli" },
			previousVersion: "1.0.0",
			changes: [],
			kind: "fix",
			version: "1.0.1",
			tag: "cli@1.0.1",
			notes: "n",
			steps: {
				"github/create-release": {
					phase: "release",
					status: "ok",
					reason: "created cli",
					output: { url: "cli" },
				},
			},
		});
	});

	it("reads every component for an `all` step", () => {
		const context = expressionContext({
			components: [values("core"), values("cli")],
			...shared,
		});
		expect(context.components).toHaveLength(2);
		expect(context.version).toBeUndefined();
		expect(
			compileExpression("contains(components[1].tag, 'cli')")(context),
		).toBe(true);
		const one = expressionContext({ components: [values("core")], ...shared });
		expect(one.version).toBe("1.0.1");
	});
});
