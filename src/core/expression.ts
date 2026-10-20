import type { ComponentInfo, Environment, StepRecord } from "./types.ts";

/**
 * What an `if:` expression can read: the release so far, as the step itself
 * would receive it.
 */
export interface ExpressionContext {
	dryRun: boolean;
	branch: string;
	cwd: string;
	/** The channel being released on, or `null` for a stable release. */
	channel: string | null;
	/** Whether the release is on a prerelease channel. */
	prerelease: boolean;
	/** The component the step runs for: `{ name, path }`; absent for `all` steps. */
	component?: { name: string; path: string };
	/** For `all` steps: every component being released, with its values. */
	components?: readonly unknown[];
	previousVersion?: string;
	previousRef?: string;
	previousTag?: string;
	changes?: readonly unknown[];
	kind?: string;
	version?: string;
	tag?: string;
	notes?: string;
	/** The components it depends on released along with it: `{ name, version, … }`. */
	dependencies?: readonly unknown[];
	/** The steps that ran before, by name: `{ type, status, reason, output }`. */
	steps: Record<string, unknown>;
}

const NAMES: readonly (keyof ExpressionContext)[] = [
	"dryRun",
	"branch",
	"cwd",
	"channel",
	"prerelease",
	"component",
	"components",
	"previousVersion",
	"previousRef",
	"previousTag",
	"changes",
	"kind",
	"version",
	"tag",
	"notes",
	"dependencies",
	"steps",
];

const VALUES = [
	"previousVersion",
	"previousRef",
	"previousTag",
	"changes",
	"kind",
	"version",
	"tag",
	"notes",
	"dependencies",
] as const;

/** Values of a component, as expressions read them. */
function valuesOf(results: Record<string, unknown>) {
	const component = results.component as ComponentInfo | undefined;
	return {
		...(component && {
			component: { name: component.name, path: component.path },
		}),
		...Object.fromEntries(
			VALUES.flatMap((name) =>
				results[name] === undefined ? [] : [[name, results[name]]],
			),
		),
	};
}

/** What an expression reads, from what a step receives: for one component, or all. */
export function expressionContext(input: unknown): ExpressionContext {
	const fields = input as {
		env: Environment;
		history: readonly StepRecord[];
		components?: readonly Record<string, unknown>[];
	} & Record<string, unknown>;
	const own = fields.component as ComponentInfo | undefined;
	const all = fields.components;
	return {
		dryRun: fields.env.dryRun,
		branch: fields.env.branch,
		cwd: fields.env.cwd,
		channel: fields.env.channel?.name ?? null,
		prerelease: fields.env.channel?.type === "prerelease",
		...(all
			? {
					components: all.map(valuesOf),
					// With one component, `all` steps read its values like any other.
					...(all.length === 1 && all[0] ? valuesOf(all[0]) : {}),
				}
			: valuesOf(fields)),
		steps: Object.fromEntries(
			fields.history
				// A component's own steps, and those for all of them.
				.filter(
					(record) =>
						record.type !== "previous" &&
						record.type !== "version" &&
						(record.component === undefined ||
							own === undefined ||
							record.component === own.name),
				)
				.map((record) => [
					record.name,
					{
						type: record.type,
						status: record.status,
						reason: record.reason,
						output:
							record.type === "release"
								? (record.output as { output?: unknown } | undefined)?.output
								: record.output,
					},
				]),
		),
	};
}

export class ExpressionError extends Error {
	override name = "ExpressionError";
}

type Node = (context: ExpressionContext) => unknown;

const FUNCTIONS: Record<string, (...args: unknown[]) => unknown> = {
	contains: (search, item) =>
		Array.isArray(search)
			? search.includes(item)
			: String(search ?? "").includes(String(item ?? "")),
	startsWith: (text, prefix) =>
		String(text ?? "").startsWith(String(prefix ?? "")),
	endsWith: (text, suffix) => String(text ?? "").endsWith(String(suffix ?? "")),
};

const TOKEN =
	/\s*(?:(\d+(?:\.\d+)?)|'((?:[^']|'')*)'|([A-Za-z_][\w-]*)|(==|!=|<=|>=|&&|\|\||[!<>().[\],]))/y;

type Token =
	| { kind: "number"; value: number }
	| { kind: "string"; value: string }
	| { kind: "name"; value: string }
	| { kind: "op"; value: string };

function tokenize(source: string): Token[] {
	const tokens: Token[] = [];
	TOKEN.lastIndex = 0;
	while (source.slice(TOKEN.lastIndex).trim() !== "") {
		const at = TOKEN.lastIndex;
		const match = TOKEN.exec(source);
		if (!match) {
			const rest = source.slice(at).trimStart();
			// Most likely a step name read as `steps.git/commit`.
			const hint =
				rest[0] === "/" ? "; read names with '/' as steps['git/commit']" : "";
			throw new ExpressionError(
				`unexpected '${rest[0]}' at ${source.length - rest.length + 1}${hint}`,
			);
		}
		const [, number, string, name, op] = match;
		if (number !== undefined)
			tokens.push({ kind: "number", value: Number(number) });
		else if (string !== undefined)
			tokens.push({ kind: "string", value: string.replaceAll("''", "'") });
		else if (name !== undefined) tokens.push({ kind: "name", value: name });
		else tokens.push({ kind: "op", value: op ?? "" });
	}
	return tokens;
}

/**
 * Compiles an `if:` expression, in the style of GitHub's: literals (`true`,
 * `'text'`, `1`, `null`), names from {@link ExpressionContext} with `.x` and
 * `['x']` access, `!`, `==`, `!=`, `<`, `<=`, `>`, `>=`, `&&`, `||`,
 * parentheses, and `contains`, `startsWith` and `endsWith`.
 */
export function compileExpression(source: string): Node {
	const tokens = tokenize(source);
	let position = 0;
	const peek = () => tokens[position];
	const isOp = (value: string) => {
		const token = peek();
		return token?.kind === "op" && token.value === value;
	};
	const expect = (value: string) => {
		if (!isOp(value)) throw unexpected();
		position++;
	};
	const unexpected = () => {
		const token = peek();
		return new ExpressionError(
			token ? `unexpected '${token.value}'` : "unexpected end",
		);
	};

	const binary = (
		next: () => Node,
		operators: Record<string, (a: unknown, b: () => unknown) => unknown>,
	) => {
		return (): Node => {
			let left = next();
			for (;;) {
				const token = peek();
				const apply = token?.kind === "op" ? operators[token.value] : undefined;
				if (!apply) return left;
				position++;
				const right = next();
				const l = left;
				left = (context) => apply(l(context), () => right(context));
			}
		};
	};

	const compare =
		(test: (a: number | string, b: number | string) => boolean) =>
		(a: unknown, b: () => unknown) => {
			const right = b();
			return (
				(typeof a === "number" || typeof a === "string") &&
				typeof right === typeof a &&
				test(a, right as number | string)
			);
		};

	const primary = (): Node => {
		const token = peek();
		if (!token) throw unexpected();
		position++;
		if (token.kind === "number" || token.kind === "string") {
			return () => token.value;
		}
		if (token.kind === "op") {
			if (token.value === "!") {
				const operand = primary();
				return (context) => !operand(context);
			}
			if (token.value === "(") {
				const inner = or();
				expect(")");
				return inner;
			}
			position--;
			throw unexpected();
		}
		const literals: Record<string, unknown> = {
			true: true,
			false: false,
			null: null,
		};
		if (token.value in literals) return () => literals[token.value];
		if (isOp("(")) {
			const fn = FUNCTIONS[token.value];
			if (!fn) {
				throw new ExpressionError(
					`unknown function '${token.value}'; use ${Object.keys(FUNCTIONS).join(", ")}`,
				);
			}
			position++;
			const args: Node[] = [];
			if (!isOp(")")) {
				args.push(or());
				while (isOp(",")) {
					position++;
					args.push(or());
				}
			}
			expect(")");
			return (context) => fn(...args.map((arg) => arg(context)));
		}
		if (!(NAMES as readonly string[]).includes(token.value)) {
			throw new ExpressionError(
				`unknown name '${token.value}'; use ${NAMES.join(", ")}`,
			);
		}
		const name = token.value as keyof ExpressionContext;
		let node: Node = (context) => context[name];
		for (;;) {
			if (isOp(".")) {
				position++;
				const key = peek();
				if (key?.kind !== "name") throw unexpected();
				position++;
				const object = node;
				node = (context) => property(object(context), key.value);
			} else if (isOp("[")) {
				position++;
				const key = or();
				expect("]");
				const object = node;
				node = (context) => property(object(context), key(context));
			} else {
				return node;
			}
		}
	};

	const comparison = binary(primary, {
		"<": compare((a, b) => a < b),
		"<=": compare((a, b) => a <= b),
		">": compare((a, b) => a > b),
		">=": compare((a, b) => a >= b),
	});
	const equality = binary(comparison, {
		"==": (a, b) => (a ?? null) === (b() ?? null),
		"!=": (a, b) => (a ?? null) !== (b() ?? null),
	});
	const and = binary(equality, { "&&": (a, b) => (a ? b() : a) });
	const or: () => Node = binary(and, { "||": (a, b) => a || b() });

	if (tokens.length === 0) throw new ExpressionError("empty expression");
	const root = or();
	if (position < tokens.length) throw unexpected();
	return root;
}

function property(object: unknown, key: unknown): unknown {
	if (typeof object !== "object" || object === null) return undefined;
	const name = String(key);
	return Object.hasOwn(object, name)
		? (object as Record<string, unknown>)[name]
		: undefined;
}
