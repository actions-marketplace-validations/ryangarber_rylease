import type { Change } from "./types.ts";

/**
 * What can be known about a release before it's made, beyond its shape: what
 * steps declare they `need`, and what steps and schemes declare they
 * `provide`. Add your own by declaration merging:
 *
 * ```ts
 * declare module "rylease" {
 *   interface Facts { "changes.jira": true }
 * }
 * ```
 */
export interface Facts {
	/** Every change has a `title`. */
	"changes.title": true;
	/** Every change has a `description`. */
	"changes.description": true;
	/** Every change has `labels`, if only `[]`. */
	"changes.labels": true;
	/** Every change has a `link`. */
	"changes.link": true;
	/** There's a previous version, in the release's scheme. */
	previousVersion: true;
	/** Versions are semantic versions, e.g. as npm requires. */
	"version.semver": true;
}

export type Fact = Extract<keyof Facts, string>;

/** The facts about `changes`, which hold only as long as the changes do. */
const CHANGE_FIELDS = ["title", "description", "labels", "link"] as const;

type ChangeField<N> = N extends `changes.${infer K}`
	? Extract<K, keyof Change>
	: never;

/** A change that's known to have the given fields. */
export type ChangeWith<K extends keyof Change> = Change & {
	[P in K]-?: Exclude<Change[P], undefined>;
};

/** A step's input, with what its `needs` guarantee. */
export type Narrow<R, N extends Fact> = [N] extends [never]
	? R
	: Omit<
			R,
			| ([ChangeField<N>] extends [never] ? never : "changes")
			| ("previousVersion" extends N ? "previousVersion" : never)
		> &
			([ChangeField<N>] extends [never]
				? unknown
				: { changes: ChangeWith<ChangeField<N>>[] }) &
			("previousVersion" extends N ? { previousVersion: string } : unknown);

/** A step's output, with what its `provides` promise. */
export type ProvidedOutput<O, P extends Fact> = [ChangeField<P>] extends [never]
	? O
	: O extends { changes: Change[] }
		? Omit<O, "changes"> & { changes: ChangeWith<ChangeField<P>>[] }
		: O;

export function isChangeFact(fact: string): boolean {
	return fact.startsWith("changes.");
}

/**
 * Throws unless every change has what the facts promise, e.g. `labels` for
 * `changes.labels`. Facts that aren't about changes aren't checked here.
 */
export function checkChanges(
	changes: readonly Change[],
	facts: readonly string[],
): void {
	for (const fact of facts) {
		const field = CHANGE_FIELDS.find((name) => fact === `changes.${name}`);
		if (field === undefined) continue;
		const index = changes.findIndex((change) => change[field] === undefined);
		if (index !== -1) {
			throw new TypeError(
				`invalid output: it provides ${fact}, but change ${index} (${changes[index]?.reason}) has no '${field}'`,
			);
		}
	}
}

/** Steps that provide each fact, by name, as they're defined; for error messages. */
const providers = new Map<string, Set<string>>();

export function registerProvider(name: string, facts: readonly string[]) {
	for (const fact of facts) {
		const names = providers.get(fact) ?? new Set();
		names.add(name);
		providers.set(fact, names);
	}
}

/** The defined steps that provide a fact, e.g. to suggest one. */
export function providersOf(fact: string): string[] {
	return [...(providers.get(fact) ?? [])];
}
