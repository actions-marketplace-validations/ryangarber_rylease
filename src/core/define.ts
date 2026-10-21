import { joinList } from "../utils/text.ts";
import type { Channel } from "./channels.ts";
import type { Component, ComponentSource } from "./components.ts";
import { type ReleaseReport, type RunOptions, runRelease } from "./engine.ts";
import type { AnyFactory, Factory } from "./factory.ts";
import { type Fact, registerProvider } from "./facts.ts";
import type { History } from "./history.ts";
import {
	type Empty,
	OptionsError,
	type OptionsInput,
	type OptionsShape,
	type OptionsValue,
	parseOptions,
} from "./options.ts";
import type { Scheme } from "./scheme.ts";
import type {
	AllStepDefinition,
	AllStepInput,
	AllStepOutput,
	EachStepDefinition,
	Phase,
	Scope,
	Step,
	StepCondition,
	StepInput,
	StepOutput,
	StepPreset,
} from "./types.ts";

export type ReleaseConfig<Context> = {
	/** Steps to run; they're ordered by phase, keeping their order within a phase. */
	steps: readonly Step<Context>[];
	/**
	 * How versions look, are ordered and bumped, e.g. `semver()`. Needed
	 * unless a preset among `steps` provides one, as `conventional` does.
	 */
	scheme?: Scheme;
	/**
	 * Each release's tag; `{version}` and `{name}` (the component's) are
	 * filled in. Defaults to `v{version}`, or `{name}@{version}` with several
	 * components.
	 */
	tag?: string;
	/**
	 * Where previous releases are found, e.g. `gitTags()`; with several, the
	 * first that finds one wins. Needed unless a preset among `steps`
	 * provides one, as every built-in preset does.
	 */
	history?: History | readonly History[];
	/**
	 * What's versioned and released: a list, or a source such as
	 * `npmWorkspaces()`. Defaults to the whole project, as one component.
	 */
	components?: readonly Component[] | ComponentSource;
	/**
	 * Prerelease and build channels, by name, e.g.
	 * `{ next: { branches: ["next"] } }` for `2.0.0-next.1`. A run releases
	 * on the first whose branches match, or the one it's given.
	 */
	channels?: Readonly<Record<string, Channel>>;
} & (undefined extends Context
	? {
			/** Shared, mutable state passed to every step. */
			context?: Context;
		}
	: {
			/** Shared, mutable state passed to every step. */
			context: Context;
		});

export interface Release<Context> {
	readonly steps: readonly Step<Context>[];
	/** Its own scheme, or its preset's. */
	readonly scheme: Scheme;
	/** Its own history, or its preset's. */
	readonly history: History | readonly History[];
	run(options?: RunOptions): Promise<ReleaseReport>;
}

/**
 * Defines a release pipeline. Pass a custom context type to type the `context`
 * every step receives: `defineRelease<{ slackTs?: string }>({ context: {}, steps })`.
 * Its `scheme` and `history` are its own, or else the preset's its steps come from.
 */
export function defineRelease<Context = undefined>(
	config: ReleaseConfig<Context>,
): Release<Context> {
	const issues: string[] = [];
	const scheme = config.scheme ?? fromPreset(config.steps, "scheme", issues);
	const history = config.history ?? fromPreset(config.steps, "history", issues);
	if (!scheme || !history) throw new OptionsError(issues);
	return {
		steps: config.steps,
		scheme,
		history,
		run: (options) =>
			runRelease(
				{
					steps: config.steps,
					context: config.context as Context,
					scheme,
					tag: config.tag,
					history,
					components: config.components,
					channels: config.channels,
				},
				options,
			),
	};
}

const EXAMPLES = { scheme: "semver", history: "git/tags" };

/** The scheme or history provided by the one preset `steps` come from that has it. */
function fromPreset<K extends "scheme" | "history">(
	steps: readonly Step<never>[],
	key: K,
	issues: string[],
): StepPreset[K] | undefined {
	const provided = new Map<string, StepPreset[K]>();
	for (const { preset } of steps) {
		if (preset?.[key] && !provided.has(preset.name)) {
			provided.set(preset.name, preset[key]);
		}
	}
	const [only, ...others] = provided.values();
	if (only && others.length === 0) return only;
	issues.push(
		provided.size === 0
			? `${key}: expected one, e.g. ${EXAMPLES[key]}, or a preset that provides one`
			: `${key}: ${joinList([...provided.keys()])} each provide one; set it`,
	);
	return undefined;
}

/** The step a factory makes, by scope. */
export type ScopedStep<T extends Phase, Sc extends Scope> = Sc extends "all"
	? AllStepDefinition<T>
	: EachStepDefinition<T>;

export interface StepFactoryDefinition<
	T extends Phase,
	N extends string,
	S extends OptionsShape,
	Sc extends Scope,
	Needs extends Fact,
	Provides extends Fact,
> {
	/** Its phase; a function works it out from its options, e.g. a `phase` option. */
	phase: T | ((options: OptionsValue<S>) => T);
	/** Identifies the step in reports and in workflow `steps`, e.g. `git/commit`. */
	name: N;
	/** One line on what the step does, for generated docs. */
	description?: string;
	/** Runs once per component (`each`, the default) or once with all of them (`all`). */
	scope?: Sc;
	/**
	 * Facts it relies on, e.g. `changes.labels`; its input is typed
	 * accordingly. A function works them out from its options, e.g. by format.
	 */
	needs?: readonly Needs[] | ((options: OptionsValue<S>) => readonly Fact[]);
	/** Facts it guarantees, e.g. that every change has `labels`. */
	provides?: readonly Provides[];
	/** A zod shape; use `.default()` for optional options and `.describe()` to document them. */
	options?: S;
	run: (
		input: (Sc extends "all"
			? AllStepInput<T, unknown, Needs>
			: StepInput<T, unknown, Needs>) & { options: OptionsValue<S> },
	) => Sc extends "all"
		? AllStepOutput<T, Provides> | Promise<AllStepOutput<T, Provides>>
		: StepOutput<T, Provides> | Promise<StepOutput<T, Provides>>;
}

/** Creates a configured step; the options argument is optional when every option is. */
export interface StepFactory<
	T extends Phase = Phase,
	N extends string = string,
	S extends OptionsShape = OptionsShape,
	Sc extends Scope = Scope,
> extends Factory<"step", N, S, ScopedStep<T, Sc>> {
	/** Its phase, or a function of its options that works it out. */
	readonly phase: T | ((options: OptionsValue<S>) => T);
	readonly scope: Sc;
	readonly needs: readonly Fact[];
	readonly provides: readonly Fact[];
}

/** Any step factory, whatever its phase, name or options. */
export interface AnyStepFactory extends AnyFactory<"step", Step> {
	readonly phase: Phase | ((options: never) => Phase);
	readonly scope: Scope;
	readonly needs: readonly Fact[];
	readonly provides: readonly Fact[];
}

/** What a factory accepts, e.g. `FactoryOptions<typeof gitCommit>`. */
export type FactoryOptions<F extends { options: OptionsShape }> = OptionsInput<
	F["options"]
>;

/**
 * Defines a reusable step whose options are declared as a zod shape. The
 * result is a factory: call it with options to get a step. Its options are
 * validated on every call, so they're just as safe when they come from a
 * workflow file.
 *
 * ```ts
 * export const header = defineStep({
 *   phase: "build-notes",
 *   name: "header",
 *   options: { text: z.string().default("Released by rylease") },
 *   run: ({ notes, options }) => ({ notes: `> ${options.text}\n\n${notes}`, reason: "added header" }),
 * });
 * header({ text: "Hi" });
 * ```
 */
export function defineStep<
	T extends Phase,
	const N extends string,
	S extends OptionsShape = Empty,
	Sc extends Scope = "each",
	const Needs extends Fact = never,
	const Provides extends Fact = never,
>(
	definition: StepFactoryDefinition<T, N, S, Sc, Needs, Provides>,
): StepFactory<T, N, S, Sc> {
	const shape = (definition.options ?? {}) as S;
	const scope = (definition.scope ?? "each") as Sc;
	const declared = definition.needs ?? [];
	const needs: readonly Fact[] = typeof declared === "function" ? [] : declared;
	const provides: readonly Fact[] = definition.provides ?? [];
	for (const key of ["phase", "name"]) {
		if (!(key in definition)) {
			throw new OptionsError([`${definition.name}: ${key} is required`]);
		}
	}
	registerProvider(definition.name, provides);
	const factory = (options?: unknown) => {
		const parsed = parseOptions(shape, options, definition.name);
		const run = definition.run as (input: unknown) => unknown;
		const needs: readonly Fact[] =
			typeof declared === "function" ? declared(parsed) : declared;
		return {
			phase:
				typeof definition.phase === "function"
					? definition.phase(parsed)
					: definition.phase,
			name: definition.name,
			...(scope === "all" && { scope }),
			...(needs.length > 0 && { needs }),
			...(provides.length > 0 && { provides }),
			run: (input: object) => run({ ...input, options: parsed }),
		};
	};
	return Object.defineProperties(factory, {
		kind: { value: "step", enumerable: true },
		phase: { value: definition.phase, enumerable: true },
		name: { value: definition.name, enumerable: true },
		description: { value: definition.description, enumerable: true },
		scope: { value: scope, enumerable: true },
		needs: { value: needs, enumerable: true },
		provides: { value: provides, enumerable: true },
		options: { value: shape, enumerable: true },
	}) as unknown as StepFactory<T, N, S, Sc>;
}

/** Options for each step of a preset, by name; `false` leaves a step out. */
export type PresetOptions<F extends readonly AnyStepFactory[]> = {
	[K in F[number] as K["name"]]?: FactoryOptions<K> | false;
};

/** A preset's own options for its steps, by name. */
export type PresetDefaults<F extends readonly AnyStepFactory[]> = {
	[K in F[number] as K["name"]]?: FactoryOptions<K>;
};

/** A named list of step factories that's configured, and used, as one. */
export interface Preset<
	N extends string = string,
	F extends readonly AnyStepFactory[] = readonly AnyStepFactory[],
> {
	(options?: PresetOptions<F>): Step[];
	readonly kind: "preset";
	readonly name: N;
	readonly description: string | undefined;
	readonly steps: F;
	readonly defaults: PresetDefaults<F>;
	/** Makes the scheme of releases made with it, unless they set their own. */
	readonly scheme: (() => Scheme) | undefined;
	/** Makes the history of releases made with it, unless they set their own. */
	readonly history: (() => History | readonly History[]) | undefined;
}

/**
 * Bundles step factories under one name. Calling the preset creates every
 * step, passing each its options by name:
 * `conventional({ "github/create-release": false, "conventional/determine-kind": { fallback: "none" } })`.
 * `defaults` sets the preset's own options per step, under the caller's;
 * `scheme` and `history` make the release's, unless it sets its own, e.g.
 * `history: gitTags` for a preset that tags its releases.
 */
export function definePreset<
	const N extends string,
	const F extends readonly AnyStepFactory[],
>(definition: {
	name: N;
	description?: string;
	steps: F;
	defaults?: PresetDefaults<F>;
	scheme?: () => Scheme;
	history?: () => History | readonly History[];
}): Preset<N, F> {
	const names = definition.steps.map((step) => step.name);
	const defaults: Record<string, object | undefined> =
		definition.defaults ?? {};
	const preset = (options: Record<string, unknown> = {}): Step[] => {
		const unknown = Object.keys(options).filter((key) => !names.includes(key));
		if (unknown.length > 0) {
			throw new OptionsError(
				unknown.map(
					(key) =>
						`${definition.name}: '${key}' isn't one of its steps (${names.join(", ")})`,
				),
			);
		}
		// Made per call: histories may keep state for the run, e.g. a lookup.
		const made: StepPreset = {
			name: definition.name,
			...(definition.scheme && { scheme: definition.scheme() }),
			...(definition.history && { history: definition.history() }),
		};
		return definition.steps.flatMap((factory) => {
			const value = options[factory.name];
			if (value === false) return [];
			const base = defaults[factory.name];
			// Anything but options (or none) is left for the step to reject.
			const merged =
				base && (value == null || typeof value === "object")
					? { ...base, ...value }
					: value;
			try {
				const step = (factory as (options: unknown) => Step)(merged);
				return [{ ...step, preset: made }];
			} catch (error) {
				// Point at the option inside the preset, e.g. `conventional.git/commit.x`.
				throw error instanceof OptionsError
					? new OptionsError(
							error.issues.map((issue) => `${definition.name}.${issue}`),
						)
					: error;
			}
		});
	};
	return Object.defineProperties(preset, {
		kind: { value: "preset", enumerable: true },
		name: { value: definition.name, enumerable: true },
		description: { value: definition.description, enumerable: true },
		steps: { value: definition.steps, enumerable: true },
		defaults: { value: definition.defaults ?? {}, enumerable: true },
		scheme: { value: definition.scheme, enumerable: true },
		history: { value: definition.history, enumerable: true },
	}) as unknown as Preset<N, F>;
}

/** What a step's condition receives. */
export type ConditionInput<S> = S extends { run: (input: infer I) => unknown }
	? I
	: never;

/**
 * Makes a step run only when `condition` holds, on top of any condition it
 * already has: `when(steps.npmPublish(), ({ env }) => !env.dryRun)`.
 */
export function when<S extends Step<never>>(
	step: S,
	condition: StepCondition<ConditionInput<S>>,
): S {
	const own = step.if as StepCondition<ConditionInput<S>> | undefined;
	const source = condition.source ?? "its condition";
	const combined: StepCondition<ConditionInput<S>> = own
		? Object.assign(
				(input: ConditionInput<S>) => condition(input) && own(input),
				{ source: `${source} && ${own.source ?? "its own condition"}` },
			)
		: condition;
	return { ...step, if: combined };
}
