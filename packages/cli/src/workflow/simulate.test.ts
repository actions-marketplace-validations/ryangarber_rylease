import { parseOutputs } from "./action.ts";
import { mocksSnippet } from "./report.ts";
import { expandMatrix } from "./simulate.ts";

describe("expandMatrix", () => {
	it("combines vectors, less exclusions", () => {
		expect(
			expandMatrix({
				os: ["linux", "mac"],
				node: [22, 24],
				exclude: [{ os: "mac", node: 22 }],
			}),
		).toEqual([
			{ os: "linux", node: 22 },
			{ os: "linux", node: 24 },
			{ os: "mac", node: 24 },
		]);
	});

	it("adds includes to what they fit, or as their own", () => {
		expect(
			expandMatrix({
				fruit: ["apple", "pear"],
				animal: ["cat"],
				include: [
					{ color: "green" },
					{ fruit: "apple", shape: "circle" },
					{ fruit: "banana" },
				],
			}),
		).toEqual([
			{ fruit: "apple", animal: "cat", color: "green", shape: "circle" },
			{ fruit: "pear", animal: "cat", color: "green" },
			{ fruit: "banana" },
		]);
		expect(expandMatrix({ include: [{ a: 1 }, { a: 2 }] })).toEqual([
			{ a: 1 },
			{ a: 2 },
		]);
		expect(expandMatrix({ component: [] })).toEqual([]);
		expect(() => expandMatrix("x")).toThrow("expected a map");
	});
});

describe("parseOutputs", () => {
	it("reads name=value and heredocs", () => {
		expect(
			parseOutputs("a=1\nnotes<<EOF_1\nline 1\nline 2\nEOF_1\nb=x=y\n"),
		).toEqual({
			a: "1",
			notes: "line 1\nline 2",
			b: "x=y",
		});
	});
});

describe("mocksSnippet", () => {
	it("mocks what can be mocked", () => {
		expect(
			mocksSnippet([
				{ path: "needs.build.outputs.sha", at: "x" },
				{ path: "vars.CHANNEL", at: "x" },
				{ path: "github.event.workflow_run.head_sha", at: "x" },
				{ path: 'needs["build"]', at: "x" },
			]),
		).toBe('outputs:\n  build:\n    sha: ""\nvars:\n  CHANNEL: ""\n');
	});
});
