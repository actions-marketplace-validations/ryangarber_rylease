import {
	type Empty,
	type OptionsInput,
	type OptionsShape,
	type OptionsValue,
	parseOptions,
} from "./options.ts";

/** What a factory makes: a step, preset, scheme, history or component source. */
export type FactoryKind =
	| "step"
	| "preset"
	| "scheme"
	| "history"
	| "components";

/**
 * Something configured with options declared as a zod shape, the same way in
 * TypeScript as in a workflow file; the options argument is optional when
 * every option is.
 */
export interface Factory<
	K extends FactoryKind,
	N extends string,
	S extends OptionsShape,
	R,
> {
	(
		...options: Empty extends OptionsInput<S>
			? [options?: OptionsInput<S>]
			: [options: OptionsInput<S>]
	): R;
	readonly kind: K;
	readonly name: N;
	readonly description: string | undefined;
	readonly options: S;
}

/** Any factory of a kind, whatever its name or options. */
export interface AnyFactory<K extends FactoryKind = FactoryKind, R = unknown> {
	// biome-ignore lint/suspicious/noExplicitAny: options are checked at runtime
	(options?: any): R;
	readonly kind: K;
	readonly name: string;
	readonly description: string | undefined;
	readonly options: OptionsShape;
}

export interface FactoryDefinition<
	N extends string,
	S extends OptionsShape,
	R,
> {
	/** Identifies it in reports and in workflow files, e.g. `calver`. */
	name: N;
	/** One line on what it does, for generated docs. */
	description?: string;
	/** A zod shape; use `.default()` for optional options and `.describe()` to document them. */
	options?: S;
	create: (options: OptionsValue<S>) => R;
}

/** Makes a factory that validates its options on every call. */
export function makeFactory<
	K extends FactoryKind,
	const N extends string,
	S extends OptionsShape,
	R,
>(kind: K, definition: FactoryDefinition<N, S, R>): Factory<K, N, S, R> {
	const shape = (definition.options ?? {}) as S;
	const factory = (options?: unknown) =>
		definition.create(parseOptions(shape, options, definition.name));
	return Object.defineProperties(factory, {
		kind: { value: kind, enumerable: true },
		name: { value: definition.name, enumerable: true },
		description: { value: definition.description, enumerable: true },
		options: { value: shape, enumerable: true },
	}) as unknown as Factory<K, N, S, R>;
}

/** Whether a value is a factory, of any kind or of the given one. */
export function isFactory<K extends FactoryKind>(
	value: unknown,
	kind?: K,
): value is AnyFactory<K> {
	if (typeof value !== "function") return false;
	const factory = value as Partial<AnyFactory>;
	return (
		typeof factory.kind === "string" &&
		(kind === undefined || factory.kind === kind) &&
		typeof factory.name === "string"
	);
}
