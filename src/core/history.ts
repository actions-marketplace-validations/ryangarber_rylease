import type { ResolvedChannel } from "./channels.ts";
import { type FactoryDefinition, makeFactory } from "./factory.ts";
import type { OptionsShape } from "./options.ts";
import type { Scheme } from "./scheme.ts";
import type { ComponentInfo, Environment, ReleaseKind } from "./types.ts";

/** Where a component's previous release is found: tags, a file, ... */
export interface History {
	readonly name: string;
	find(input: HistoryInput): Promise<Found | undefined>;
	/**
	 * The highest counter of a channel's versions of a target, among every
	 * release, not only those on HEAD, so channel versions never collide.
	 */
	count?(input: HistoryInput & { target: string }): Promise<number>;
	/** Whether a release's tag exists already. */
	exists?(input: HistoryInput & { releaseTag: string }): Promise<boolean>;
}

export interface HistoryInput {
	env: Environment;
	component: ComponentInfo;
	scheme: Scheme;
	/** The component's tag template, with `{name}` filled in, e.g. `v{version}`. */
	tag: string;
	/** The channel being released on; without one, only stable releases count. */
	channel?: ResolvedChannel | undefined;
	/** Every channel, to tell their versions from stable ones. */
	channels: readonly ResolvedChannel[];
}

/** The previous release; `undefined` from `find` when there's none. */
export interface Found {
	/** Absent when the release's version isn't one of the scheme's. */
	version?: string;
	/** Its commit; without one, changes are collected from all history. */
	ref?: string;
	tag?: string;
	/** e.g. `v1.4.0 at abc1234, nearest on HEAD`. */
	reason: string;
	/**
	 * On a channel, the nearest stable release, when `version` is a channel
	 * version; new versions are bumped from it.
	 */
	stable?: { version: string; ref?: string; tag?: string };
	/**
	 * A release that's been prepared but not released, e.g. by a merged
	 * release pull request: only its `release` steps run.
	 */
	pending?: Pending;
}

/** A prepared release, as a history finds it. */
export interface Pending {
	version: string;
	notes?: string;
	kind?: ReleaseKind;
	previousVersion?: string;
	/** e.g. `prepared in #12`. */
	reason: string;
}

/** Defines where previous releases are found, with options as a zod shape. */
export function defineHistory<const N extends string, S extends OptionsShape>(
	definition: FactoryDefinition<N, S, History>,
) {
	return makeFactory("history", definition);
}
