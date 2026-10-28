// biome-ignore-all lint/suspicious/noTemplateCurlyInString: these are GitHub expressions, not templates.
import { condition, evaluate, interpolate, type Scope } from "./expressions.ts";

const scope = (
	contexts: Record<string, unknown> = {},
	rest: Partial<Scope> = {},
): Scope => ({
	contexts: {
		github: {
			event_name: "push",
			ref_name: "main",
			event: { commits: [{ id: "a" }, { id: "b" }] },
		},
		env: { DRY_RUN: "true", N: "3" },
		needs: {
			release: {
				result: "success",
				outputs: { released: "true", components: '["a","b"]' },
			},
		},
		...contexts,
	},
	...rest,
});

describe("GitHub expressions", () => {
	it("compares loosely, ignoring case", () => {
		expect(evaluate("'1' == 1", scope())).toBe(true);
		expect(evaluate("'' == 0", scope())).toBe(true);
		expect(evaluate("null == 0", scope())).toBe(true);
		expect(evaluate("true == 1", scope())).toBe(true);
		expect(evaluate("'abc' == 'ABC'", scope())).toBe(true);
		expect(evaluate("'x' == 0", scope())).toBe(false);
		expect(evaluate("'x' < 1", scope())).toBe(false);
		expect(evaluate("env.N >= 3", scope())).toBe(true);
		expect(evaluate("'a' < 'B'", scope())).toBe(true);
	});

	it("returns operands from && and ||", () => {
		expect(evaluate("github.missing || 'fallback'", scope())).toBe("fallback");
		expect(evaluate("github.ref_name && 'yes'", scope())).toBe("yes");
		expect(evaluate("'' && 'no'", scope())).toBe("");
		expect(evaluate("!github.ref_name", scope())).toBe(false);
	});

	it("reads contexts, ignoring case, and filters", () => {
		expect(evaluate("GITHUB.EVENT_NAME", scope())).toBe("push");
		expect(evaluate("github['ref_name']", scope())).toBe("main");
		expect(evaluate("github.event.commits.*.id", scope())).toEqual(["a", "b"]);
		expect(evaluate("github.event.commits[1].id", scope())).toBe("b");
		expect(() => evaluate("nope.x", scope())).toThrow(
			"Unrecognized named-value: 'nope'",
		);
	});

	it("tells of reads that find nothing", () => {
		const missing: string[] = [];
		const result = evaluate(
			"needs.release.outputs.version || needs['build'].outputs.sha",
			scope({}, { missing: (path) => missing.push(path) }),
		);
		expect(result).toBe(null);
		expect(missing).toEqual([
			"needs.release.outputs.version",
			'needs["build"]',
		]);
	});

	it("has GitHub's functions", () => {
		expect(evaluate("contains('Hello', 'ELL')", scope())).toBe(true);
		expect(
			evaluate(
				"contains(fromJSON(needs.release.outputs.components), 'b')",
				scope(),
			),
		).toBe(true);
		expect(evaluate("startsWith(github.ref_name, 'MA')", scope())).toBe(true);
		expect(evaluate("endsWith('v1.2', '.2')", scope())).toBe(true);
		expect(evaluate("format('{0}-{1} {{x}}', 'a', 1)", scope())).toBe(
			"a-1 {x}",
		);
		expect(evaluate("join(fromJSON('[1,2]'), '+')", scope())).toBe("1+2");
		expect(evaluate("toJSON(fromJSON('{\"a\":1}'))", scope())).toBe(
			'{\n  "a": 1\n}',
		);
		expect(() => evaluate("fromJSON('nope')", scope())).toThrow("isn't JSON");
		const warnings: string[] = [];
		expect(
			evaluate(
				"hashFiles('**/x')",
				scope({}, { warn: (text) => warnings.push(text) }),
			),
		).toBe("");
		expect(warnings).toHaveLength(1);
	});

	it("interpolates, keeping a lone expression's value", () => {
		expect(interpolate("${{ env.DRY_RUN }}", scope())).toBe("true");
		expect(interpolate("${{ fromJSON('[1]') }}", scope())).toEqual([1]);
		expect(interpolate("v${{ env.N }}-${{ github.ref_name }}", scope())).toBe(
			"v3-main",
		);
		expect(interpolate("a '}}' b", scope())).toBe("a '}}' b");
		expect(interpolate("${{ '}}' }}", scope())).toBe("}}");
		expect(interpolate("no expressions", scope())).toBe("no expressions");
	});

	it("checks conditions, as success() && it without a status function", () => {
		expect(condition(undefined, scope())).toBe(true);
		expect(condition(undefined, scope({}, { status: "failure" }))).toBe(false);
		expect(condition("github.event_name == 'push'", scope())).toBe(true);
		expect(
			condition("${{ github.event_name == 'pull_request' }}", scope()),
		).toBe(false);
		expect(
			condition(
				"github.event_name == 'push'",
				scope({}, { status: "failure" }),
			),
		).toBe(false);
		expect(
			condition(
				"always() && github.event_name == 'push'",
				scope({}, { status: "failure" }),
			),
		).toBe(true);
		expect(condition("failure()", scope({}, { status: "failure" }))).toBe(true);
		expect(
			condition("success() || failure()", scope({}, { status: "skipped" })),
		).toBe(false);
		expect(condition(false, scope())).toBe(false);
		// Text around an expression is just text, which is truthy.
		expect(condition("${{ false }} == true", scope())).toBe(true);
	});
});
