import { type FactoryDefinition, makeFactory } from "./factory.ts";
import type { Fact } from "./facts.ts";
import type { OptionsShape } from "./options.ts";
import type { ReleaseKind } from "./types.ts";

/**
 * A version scheme: the one place that knows what a version looks like. It
 * recognizes and orders versions, works out the next, and names their parts
 * for templates. Everything else treats versions as plain text.
 */
export interface Scheme {
	/** Describes it in reports, e.g. `semver` or `calver YYYY.MM.MICRO`. */
	readonly name: string;
	/** Facts that hold for every version it makes, e.g. `version.semver`. */
	readonly traits?: readonly Fact[];
	/** Whether a version is one of this scheme's, strictly. */
	matches(version: string): boolean;
	/** Orders two of its versions. */
	compare(a: string, b: string): number;
	/**
	 * The next version: after `previous` by `kind`, or the first one without
	 * a previous version, e.g. on a first release.
	 */
	bump(input: BumpInput): { version: string; reason: string };
	/** `{placeholders}` for templates, e.g. `{ major: "1", minor: "2", patch: "3" }`. */
	fields?(version: string): Record<string, string>;
	/**
	 * How channel versions are written, by channel type, e.g.
	 * `{ prerelease: "{version}rc{n}" }`; by default `{version}-{channel}.{n}`
	 * and `{version}+{channel}.{n}`.
	 */
	readonly formats?: { readonly prerelease?: string; readonly build?: string };
}

export interface BumpInput {
	/** Absent on a first release, or when the scheme changed since the last one. */
	previous?: string;
	kind: ReleaseKind;
	branch: string;
	date: Date;
}

/**
 * Defines a version scheme whose options are declared as a zod shape. The
 * result is a factory, like a step's: `calver({ format: "YY.MINOR.MICRO" })`.
 */
export function defineScheme<const N extends string, S extends OptionsShape>(
	definition: FactoryDefinition<N, S, Scheme>,
) {
	return makeFactory("scheme", definition);
}
