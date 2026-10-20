import * as z from "zod";
import type * as core from "zod/v4/core";

export { z };

/** A step's options: a zod shape, from `zod` or `zod/mini`. */
export type OptionsShape = core.$ZodShape;

/** What a step accepts: options with a default may be left out. */
export type OptionsInput<S extends OptionsShape> = core.$InferObjectInput<
	S,
	Empty
>;

/** What a step's `run` receives: every default applied. */
export type OptionsValue<S extends OptionsShape> = core.$InferObjectOutput<
	S,
	Empty
>;

/** An object type with no properties. */
export type Empty = Record<never, never>;

/** Options that don't match a step's schema; the message lists every problem. */
export class OptionsError extends Error {
	readonly issues: readonly string[];

	constructor(issues: readonly string[]) {
		super(issues.join("\n"));
		this.name = "OptionsError";
		this.issues = issues;
	}
}

/**
 * Validates options against a shape, applying defaults. Unknown keys are
 * rejected. Each problem is reported with `path` prepended, e.g.
 * `conventional/determine-kind.types.docs: Invalid option: ...`.
 */
export function parseOptions<S extends OptionsShape>(
	shape: S,
	value: unknown,
	path: string,
): OptionsValue<S> {
	const result = z.strictObject(shape).safeParse(value ?? {});
	if (result.success) return result.data as OptionsValue<S>;
	throw new OptionsError(
		result.error.issues.map(
			(issue) => `${joinPath(path, issue.path)}: ${issue.message}`,
		),
	);
}

export function joinPath(
	path: string,
	keys: readonly PropertyKey[] = [],
): string {
	return keys.reduce<string>(
		(text, key) =>
			typeof key === "number"
				? `${text}[${key}]`
				: /^[\w-]+$/.test(String(key))
					? `${text}.${String(key)}`
					: `${text}[${JSON.stringify(String(key))}]`,
		path,
	);
}
