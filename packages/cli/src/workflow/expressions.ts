/**
 * GitHub Actions expressions, `${{ ... }}`, evaluated as GitHub does: loose,
 * case-insensitive comparisons, `&&` and `||` that return an operand, and
 * GitHub's functions. Unlike rylease's own `if:` expressions, which are
 * strict, these follow https://docs.github.com/actions/learn-github-actions/expressions.
 */

export class ExpressionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ExpressionError";
	}
}

/** Where an expression is evaluated: what it can read, and how the job is going. */
export interface Scope {
	/** The contexts there, by name, e.g. `github`, `env`, `needs`. */
	contexts: Readonly<Record<string, unknown>>;
	/**
	 * For `success()`, `failure()` and `cancelled()`; defaults to `success`.
	 * `skipped` is for jobs after a skipped one: neither success nor failure.
	 */
	status?: "success" | "failure" | "cancelled" | "skipped";
	/** Told of each read that found nothing, by its path, e.g. `needs.build.outputs.sha`. */
	missing?: (path: string) => void;
	/** Told of what can't be simulated, e.g. `hashFiles`. */
	warn?: (message: string) => void;
}

type Node = (scope: Scope) => unknown;

/** Values from `.*`, which later property reads map over. */
const FILTERED = Symbol("filtered");
type Filtered = unknown[] & { [FILTERED]: true };

function filtered(values: unknown[]): Filtered {
	return Object.assign(values, { [FILTERED]: true as const });
}

function isFiltered(value: unknown): value is Filtered {
	return Array.isArray(value) && FILTERED in value;
}

type Token =
	| { kind: "number"; value: number }
	| { kind: "string"; value: string }
	| { kind: "name"; value: string }
	| { kind: "op"; value: string };

const TOKEN =
	/\s*(?:(0x[0-9a-fA-F]+|-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)|'((?:[^']|'')*)'|([A-Za-z_][A-Za-z0-9_-]*)|(==|!=|<=|>=|&&|\|\||[!<>()[\].,*]))/y;

function tokenize(source: string): Token[] {
	const tokens: Token[] = [];
	TOKEN.lastIndex = 0;
	while (source.slice(TOKEN.lastIndex).trim() !== "") {
		const at = TOKEN.lastIndex;
		const match = TOKEN.exec(source);
		if (!match) {
			const rest = source.slice(at).trimStart();
			throw new ExpressionError(
				`unexpected '${rest[0]}' at ${source.length - rest.length + 1}`,
			);
		}
		const [, number, string, name, op] = match;
		const previous = tokens.at(-1);
		// `a-1` isn't a thing, but `x == -1` is: a sign only starts a number.
		if (
			number?.startsWith("-") &&
			previous &&
			(previous.kind !== "op" ||
				previous.value === ")" ||
				previous.value === "]")
		) {
			throw new ExpressionError(`unexpected '-' at ${at + 1}`);
		}
		if (number !== undefined)
			tokens.push({ kind: "number", value: Number(number) });
		else if (string !== undefined)
			tokens.push({ kind: "string", value: string.replaceAll("''", "'") });
		else if (name !== undefined) tokens.push({ kind: "name", value: name });
		else tokens.push({ kind: "op", value: op ?? "" });
	}
	return tokens;
}

const STATUS_FUNCTIONS = ["success", "failure", "always", "cancelled"];

/** Compiles an expression, without `${{ }}`. */
function compile(source: string): Node {
	const tokens = tokenize(source);
	let position = 0;
	const peek = () => tokens[position];
	const isOp = (value: string) => {
		const token = peek();
		return token?.kind === "op" && token.value === value;
	};
	const unexpected = () => {
		const token = peek();
		return new ExpressionError(
			token
				? `unexpected '${token.value}' in \`${source}\``
				: `unexpected end of \`${source}\``,
		);
	};
	const expect = (value: string) => {
		if (!isOp(value)) throw unexpected();
		position++;
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
				left = (scope) => apply(l(scope), () => right(scope));
			}
		};
	};

	const access = (root: string): Node => {
		type Accessor =
			| { kind: "name"; name: string }
			| { kind: "index"; key: Node }
			| { kind: "star" };
		const accessors: Accessor[] = [];
		for (;;) {
			if (isOp(".")) {
				position++;
				const key = peek();
				if (key?.kind === "op" && key.value === "*") {
					position++;
					accessors.push({ kind: "star" });
				} else if (key?.kind === "name") {
					position++;
					accessors.push({ kind: "name", name: key.value });
				} else throw unexpected();
			} else if (isOp("[")) {
				position++;
				if (isOp("*")) {
					position++;
					accessors.push({ kind: "star" });
				} else accessors.push({ kind: "index", key: or() });
				expect("]");
			} else break;
		}
		return (scope) => {
			const context = lookup(scope.contexts, root);
			if (context === undefined) {
				throw new ExpressionError(`Unrecognized named-value: '${root}'`);
			}
			let value: unknown = context;
			let path = root;
			for (const accessor of accessors) {
				if (accessor.kind === "star") {
					path += ".*";
					value = star(value);
					continue;
				}
				const key =
					accessor.kind === "name" ? accessor.name : accessor.key(scope);
				path +=
					accessor.kind === "name" ? `.${key}` : `[${JSON.stringify(key)}]`;
				value = isFiltered(value)
					? filtered(
							value
								.map((item) => property(item, key))
								.filter((item) => item !== undefined),
						)
					: property(value, key);
				if (value === undefined) {
					scope.missing?.(path);
					return null;
				}
			}
			// What `.*` made is a plain list, once the reads that map over it are done.
			return isFiltered(value) ? [...value] : value;
		};
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
				return (scope) => !truthy(operand(scope));
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
			const name = token.value.toLowerCase();
			const fn = FUNCTIONS[name];
			if (!fn)
				throw new ExpressionError(`Unrecognized function: '${token.value}'`);
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
			return (scope) => fn(scope, ...args.map((arg) => arg(scope)));
		}
		return access(token.value);
	};

	const comparison = binary(primary, {
		"<": (a, b) => compare(a, b(), (x) => x < 0),
		"<=": (a, b) => compare(a, b(), (x) => x <= 0),
		">": (a, b) => compare(a, b(), (x) => x > 0),
		">=": (a, b) => compare(a, b(), (x) => x >= 0),
	});
	const equality = binary(comparison, {
		"==": (a, b) => equal(a, b()),
		"!=": (a, b) => !equal(a, b()),
	});
	const and = binary(equality, { "&&": (a, b) => (truthy(a) ? b() : a) });
	const or: () => Node = binary(and, { "||": (a, b) => (truthy(a) ? a : b()) });

	if (tokens.length === 0) throw new ExpressionError("empty expression");
	const root = or();
	if (position < tokens.length) throw unexpected();
	return root;
}

/** Whether an expression calls `success()`, `failure()`, `always()` or `cancelled()`. */
function checksStatus(source: string): boolean {
	return tokenize(source).some(
		(token, index, tokens) =>
			token.kind === "name" &&
			STATUS_FUNCTIONS.includes(token.value.toLowerCase()) &&
			tokens[index + 1]?.kind === "op" &&
			tokens[index + 1]?.value === "(",
	);
}

/** Evaluates an expression, without `${{ }}`. */
export function evaluate(source: string, scope: Scope): unknown {
	return compile(source)(scope);
}

/**
 * A value that may hold `${{ }}`: an expression's own value when it's the
 * whole text, e.g. an object from `fromJSON`, or else text with each filled in.
 */
export function interpolate(text: string, scope: Scope): unknown {
	const parts = split(text);
	if (parts.length === 1 && typeof parts[0] !== "string") {
		const [only] = parts;
		if (only && text.trim() === `\${{${only.source}}}`)
			return evaluate(only.source, scope);
	}
	return parts
		.map((part) =>
			typeof part === "string" ? part : toText(evaluate(part.source, scope)),
		)
		.join("");
}

/** Text and the `${{ }}` expressions in it, in order. */
function split(text: string): (string | { source: string })[] {
	const parts: (string | { source: string })[] = [];
	let rest = text;
	for (;;) {
		const start = rest.indexOf("${{");
		if (start === -1) break;
		const end = closing(rest, start + 3);
		if (end === -1) throw new ExpressionError(`unclosed \${{ in \`${text}\``);
		if (start > 0) parts.push(rest.slice(0, start));
		parts.push({ source: rest.slice(start + 3, end) });
		rest = rest.slice(end + 2);
	}
	if (rest !== "" || parts.length === 0) parts.push(rest);
	return parts;
}

/** Where `}}` closes an expression, outside its strings; -1 if nowhere. */
function closing(text: string, from: number): number {
	let quoted = false;
	for (let index = from; index < text.length; index++) {
		if (text[index] === "'") quoted = !quoted;
		else if (!quoted && text.startsWith("}}", index)) return index;
	}
	return -1;
}

/** Every value in `value`, recursively, with `${{ }}` filled in. */
export function interpolateAll(value: unknown, scope: Scope): unknown {
	if (typeof value === "string") return interpolate(value, scope);
	if (Array.isArray(value))
		return value.map((item) => interpolateAll(item, scope));
	if (typeof value === "object" && value !== null) {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [
				key,
				interpolateAll(item, scope),
			]),
		);
	}
	return value;
}

/**
 * Whether an `if:` holds. It may be written with or without `${{ }}`, and
 * without a status function, it holds only while everything succeeds.
 */
export function condition(value: unknown, scope: Scope): boolean {
	if (value === undefined || value === null || value === "") {
		return (scope.status ?? "success") === "success";
	}
	if (typeof value === "boolean")
		return value && (scope.status ?? "success") === "success";
	const text = String(value).trim();
	const source =
		text.startsWith("${{") &&
		text.endsWith("}}") &&
		closing(text, 3) === text.length - 2
			? text.slice(3, -2)
			: text;
	if (source.includes("${{")) {
		// Text around an expression, e.g. `${{ x }} == 'y'`: GitHub reads it as text, always truthy.
		return (
			truthy(interpolate(source, scope)) &&
			(scope.status ?? "success") === "success"
		);
	}
	const result = truthy(evaluate(source, scope));
	return checksStatus(source)
		? result
		: result && (scope.status ?? "success") === "success";
}

function truthy(value: unknown): boolean {
	if (value === null || value === undefined || value === false) return false;
	if (typeof value === "number") return value !== 0 && !Number.isNaN(value);
	if (typeof value === "string") return value !== "";
	return true;
}

/** A value as text, as GitHub writes it into `with:`, `env:` and `run:`. */
export function toText(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "string") return value;
	if (typeof value === "boolean" || typeof value === "number")
		return String(value);
	return Array.isArray(value) ? "Array" : "Object";
}

function toNumber(value: unknown): number {
	if (value === null || value === undefined) return 0;
	if (typeof value === "boolean") return value ? 1 : 0;
	if (typeof value === "number") return value;
	if (typeof value === "string") {
		const text = value.trim();
		if (text === "") return 0;
		if (/^0x[0-9a-f]+$/i.test(text)) return Number.parseInt(text, 16);
		return /^-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)
			? Number(text)
			: Number.NaN;
	}
	return Number.NaN;
}

function typeOf(value: unknown): string {
	return value === null || value === undefined
		? "null"
		: Array.isArray(value)
			? "object"
			: typeof value;
}

function equal(a: unknown, b: unknown): boolean {
	const type = typeOf(a);
	if (type === typeOf(b)) {
		if (type === "null") return true;
		if (type === "string")
			return (a as string).toUpperCase() === (b as string).toUpperCase();
		return a === b;
	}
	return toNumber(a) === toNumber(b);
}

function compare(
	a: unknown,
	b: unknown,
	test: (order: number) => boolean,
): boolean {
	if (typeof a === "string" && typeof b === "string") {
		const x = a.toUpperCase();
		const y = b.toUpperCase();
		return test(x < y ? -1 : x > y ? 1 : 0);
	}
	const x = toNumber(a);
	const y = toNumber(b);
	if (Number.isNaN(x) || Number.isNaN(y)) return false;
	return test(x - y);
}

/** A key of an object, as GitHub reads it: exactly, or else ignoring case. */
function lookup(
	object: Readonly<Record<string, unknown>>,
	key: string,
): unknown {
	if (Object.hasOwn(object, key)) return object[key];
	const lower = key.toLowerCase();
	const found = Object.keys(object).find(
		(name) => name.toLowerCase() === lower,
	);
	return found === undefined ? undefined : object[found];
}

function property(object: unknown, key: unknown): unknown {
	if (Array.isArray(object)) {
		const index = typeof key === "number" ? key : toNumber(key);
		return Number.isInteger(index) ? object[index] : undefined;
	}
	if (typeof object !== "object" || object === null) return undefined;
	return lookup(object as Record<string, unknown>, toText(key));
}

function star(value: unknown): Filtered {
	if (isFiltered(value)) return filtered(value.flatMap((item) => star(item)));
	if (Array.isArray(value)) return filtered([...value]);
	if (typeof value === "object" && value !== null)
		return filtered(Object.values(value));
	return filtered([]);
}

const FUNCTIONS: Record<string, (scope: Scope, ...args: unknown[]) => unknown> =
	{
		contains: (_scope, search, item) =>
			Array.isArray(search)
				? search.some((element) => equal(element, item))
				: toText(search).toUpperCase().includes(toText(item).toUpperCase()),
		startswith: (_scope, text, prefix) =>
			toText(text).toUpperCase().startsWith(toText(prefix).toUpperCase()),
		endswith: (_scope, text, suffix) =>
			toText(text).toUpperCase().endsWith(toText(suffix).toUpperCase()),
		format: (_scope, template, ...args) =>
			toText(template).replace(
				/\{\{|\}\}|\{(\d+)\}/g,
				(match, index?: string) => {
					if (match === "{{") return "{";
					if (match === "}}") return "}";
					if (Number(index) >= args.length) {
						throw new ExpressionError(`format: no argument for {${index}}`);
					}
					return toText(args[Number(index)]);
				},
			),
		join: (_scope, value, separator = ",") =>
			Array.isArray(value)
				? value.map(toText).join(toText(separator))
				: toText(value),
		tojson: (_scope, value) => JSON.stringify(value ?? null, null, 2),
		fromjson: (_scope, value) => {
			try {
				return JSON.parse(toText(value));
			} catch {
				throw new ExpressionError(`fromJSON: '${toText(value)}' isn't JSON`);
			}
		},
		hashfiles: (scope, ...patterns) => {
			scope.warn?.(
				`hashFiles(${patterns.map((pattern) => `'${toText(pattern)}'`).join(", ")}) isn't simulated; it's ''`,
			);
			return "";
		},
		success: (scope) => (scope.status ?? "success") === "success",
		failure: (scope) => scope.status === "failure",
		cancelled: (scope) => scope.status === "cancelled",
		always: () => true,
	};
