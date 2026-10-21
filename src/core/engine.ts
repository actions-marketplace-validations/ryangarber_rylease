import { performance } from "node:perf_hooks";
import { tryGit } from "../utils/git.ts";
import { fill, versionValues } from "../utils/template.ts";
import { firstDifference, parseVersion } from "../utils/version.ts";
import {
	type Channel,
	type Classified,
	channelVersion,
	checkChannels,
	classify,
	compareClassified,
	type ResolvedChannel,
	resolveChannels,
	selectChannel,
} from "./channels.ts";
import {
	type Component,
	type ComponentSource,
	type ResolvedComponent,
	resolveComponents,
} from "./components.ts";
import { checkChanges, isChangeFact, providersOf } from "./facts.ts";
import type { Found, History, HistoryInput } from "./history.ts";
import { defaultReporter, type Reporter } from "./reporter.ts";
import type { Scheme } from "./scheme.ts";
import {
	type Change,
	type Dependency,
	type Environment,
	KINDS,
	type Kind,
	PHASES,
	type Phase,
	type ReleaseKind,
	type ReleaseResult,
	type Step,
	type StepRecord,
} from "./types.ts";

export interface RunOptions {
	/** Defaults to `process.cwd()`. */
	cwd?: string;
	/** Defaults to the CI's branch (GitHub Actions or GitLab CI), or the checked-out one. */
	branch?: string;
	/** Defaults to `false`. */
	dryRun?: boolean;
	/** Defaults to pretty output on stdout; pass `null` for silence. */
	reporter?: Reporter | null;
	/**
	 * Releases that have already been worked out, e.g. by an earlier job: only
	 * the `release` steps run, for these versions, and every other step is
	 * skipped. With several components, each names its own.
	 */
	release?: GivenRelease | readonly GivenRelease[];
	/**
	 * The channel to release on, e.g. `nightly`. Defaults to the first whose
	 * branches match, or a stable release.
	 */
	channel?: string;
}

export interface GivenRelease {
	version: string;
	/** Defaults to none. */
	notes?: string;
	/** Defaults to the version itself. */
	previousVersion?: string;
	/** Defaults to the difference between the versions, or `fix`. */
	kind?: ReleaseKind;
	/** The component it's for; needed when there are several. */
	component?: string;
}

/** How a release is made: its steps, and how versions are found and made. */
export interface ReleaseSetup<Ctx> {
	steps: readonly Step<Ctx>[];
	context: Ctx;
	scheme: Scheme;
	/** Defaults to `v{version}` for one component, `{name}@{version}` for several. */
	tag?: string | undefined;
	/** Where previous releases are found; the first that finds one wins. */
	history: History | readonly History[];
	/** Defaults to one component, the whole project. */
	components?: readonly Component[] | ComponentSource | undefined;
	/** Prerelease and build channels, by name. Defaults to none. */
	channels?: Readonly<Record<string, Channel>> | undefined;
}

/**
 * `pending` when a `write` step left the release to later, e.g. to a
 * release pull request.
 */
export type ReleaseStatus = "released" | "pending" | "unchanged" | "failed";

export interface ComponentReport {
	name: string;
	path: string;
	status: ReleaseStatus;
	previousVersion?: string;
	previousRef?: string;
	previousTag?: string;
	kind?: Kind;
	version?: string;
	tag?: string;
	notes?: string;
	/** The components it depends on that were released along with it. */
	dependencies: Dependency[];
	releases: ReleaseResult[];
}

export interface ReleaseReport {
	env: Environment;
	status: ReleaseStatus;
	records: StepRecord[];
	/** Every component, dependencies first. */
	components: ComponentReport[];
	/** With one component, its values, for convenience. */
	previousVersion?: string;
	previousRef?: string;
	kind?: Kind;
	version?: string;
	notes?: string;
	/** With one component, the results of its `write`, `stage` and `release` steps. */
	releases: ReleaseResult[];
	/** Why the release was left to later, when it's `pending`. */
	deferred?: string;
	error?: unknown;
}

export class ReleaseError extends Error {
	readonly report: ReleaseReport;

	constructor(message: string, report: ReleaseReport, options?: ErrorOptions) {
		super(message, options);
		this.name = "ReleaseError";
		this.report = report;
	}
}

function phaseIndex(phase: Phase): number {
	return PHASES.indexOf(phase);
}

const KIND_PHASE = phaseIndex("determine-kind");

/** Phases that must have at least one step for a release to be possible. */
const REQUIRED_PHASES = PHASES.filter(
	(phase) => phase !== "write" && phase !== "stage" && phase !== "release",
);

/** What each phase produces, where later phases read it. */
const PHASE_VALUES = {
	"read-changes": "changes",
	"determine-kind": "kind",
	"build-notes": "notes",
	write: "releases",
	stage: "releases",
	release: "releases",
} as const satisfies Record<Phase, keyof State>;

const CHANGE_FACTS = [
	"changes.title",
	"changes.description",
	"changes.labels",
	"changes.link",
];

interface State {
	component: ResolvedComponent;
	previousVersion: string | undefined;
	previousRef: string | undefined;
	previousTag: string | undefined;
	changes: Change[] | undefined;
	kind: Kind | undefined;
	/** A version a `determine-kind` step asked for. */
	exact: string | undefined;
	version: string | undefined;
	tag: string | undefined;
	placeholders: Record<string, string> | undefined;
	notes: string | undefined;
	dependencies: Dependency[];
	releases: ReleaseResult[];
	/** What's known to hold, e.g. `changes.labels`. */
	facts: Set<string>;
	/** Whether it's still being released: false once its kind is `none`. */
	live: boolean;
	/** The previous stable version, which new versions are bumped from. */
	stable: string | undefined;
	/** The channel it's released on, with its format for the scheme. */
	channel: ResolvedChannel | undefined;
	channels: ResolvedChannel[];
	/** Why only its `release` steps run, when its version was given. */
	given: string | undefined;
}

/** Stable sort of steps by phase; steps of the same phase keep their order. */
export function sortSteps<S extends { phase: Phase }>(
	steps: readonly S[],
): S[] {
	return [...steps].sort((a, b) => phaseIndex(a.phase) - phaseIndex(b.phase));
}

/** Steps as the engine handles them, whatever their phase and scope. */
type AnyStep = {
	phase: Phase;
	name: string;
	scope?: "each" | "all";
	needs?: readonly string[];
	provides?: readonly string[];
	if?: ((input: unknown) => boolean) & { source?: string };
	run: (input: unknown) => unknown;
};

export async function runRelease<Ctx>(
	setup: ReleaseSetup<Ctx>,
	options: RunOptions = {},
): Promise<ReleaseReport> {
	const cwd = options.cwd ?? process.cwd();
	const env: Environment = {
		cwd,
		branch: options.branch ?? (await detectBranch(cwd)),
		dryRun: options.dryRun ?? false,
	};
	const reporter =
		options.reporter === undefined ? defaultReporter() : options.reporter;
	const given = options.release === undefined ? [] : [options.release].flat();
	const ordered = sortSteps(setup.steps as unknown as readonly AnyStep[]);
	const records: StepRecord[] = [];
	let states: State[] = [];
	let deferred: string | undefined;

	const report = (status: ReleaseStatus, error?: unknown): ReleaseReport => {
		const components = states.map(
			(state): ComponentReport => ({
				name: state.component.info.name,
				path: state.component.info.path,
				status:
					state.kind === "none" || !state.live
						? "unchanged"
						: status === "failed"
							? "failed"
							: status,
				dependencies: state.dependencies,
				releases: state.releases,
				...definedOnly({
					previousVersion: state.previousVersion,
					previousRef: state.previousRef,
					previousTag: state.previousTag,
					kind: state.kind,
					version: state.version,
					tag: state.tag,
					notes: state.notes,
				}),
			}),
		);
		const only = states.length === 1 ? states[0] : undefined;
		return {
			env,
			status,
			records,
			components,
			releases: only?.releases ?? [],
			...definedOnly({
				previousVersion: only?.previousVersion,
				previousRef: only?.previousRef,
				kind: only?.kind,
				version: only?.version,
				notes: only?.notes,
				deferred,
				error,
			}),
		};
	};
	const record = (entry: StepRecord) => {
		records.push(entry);
		reporter?.step?.(entry);
	};
	const fail = (error: unknown, message = errorMessage(error)): never => {
		const result = report("failed", error);
		reporter?.finish?.(result);
		throw new ReleaseError(message, result, { cause: error });
	};

	let resolved: ResolvedComponent[];
	try {
		const channels = setup.channels ?? {};
		checkChannels(channels);
		const channel = selectChannel(channels, env.branch, options.channel);
		if (channel) env.channel = channel;
		resolved = await resolveSetup(setup, env);
	} catch (error) {
		reporter?.start?.(env, ordered, []);
		return fail(error);
	}
	reporter?.start?.(
		env,
		[
			...resolved.flatMap((component) => [
				...historiesOf(component).map(({ name }) => ({
					phase: "read-version" as const,
					name,
				})),
				{ phase: "determine-version" as const, name: component.scheme.name },
			]),
			...ordered,
		],
		resolved.map(({ info }) => info),
	);
	states = resolved.map((component) =>
		newState(component, setup.channels ?? {}, env),
	);

	const missing =
		given.length > 0
			? []
			: REQUIRED_PHASES.filter(
					(phase) => !ordered.some((step) => step.phase === phase),
				);
	if (missing.length > 0) {
		fail(new Error(`no step provided for: ${missing.join(", ")}`));
	}

	if (given.length > 0) {
		for (const state of states) state.live = false;
		for (const release of given) {
			const target = givenTarget(states, release.component);
			if (typeof target === "string") fail(new Error(target));
			const state = target as State;
			setGiven(state, release, `releasing the given ${release.version}`);
			if (release.previousVersion !== undefined) {
				state.facts.add("previousVersion");
			}
		}
	} else {
		for (const state of states) {
			const start = performance.now();
			const { scheme } = state.component;
			try {
				const found = await findPrevious(state, env);
				const previous = found.found;
				const kind =
					previous?.version === undefined
						? undefined
						: classify(previous.version, scheme, state.channels);
				const foreign = kind?.type === "foreign";
				Object.assign(state, {
					previousVersion: foreign ? undefined : previous?.version,
					previousRef: previous?.ref,
					previousTag: previous?.tag,
					stable:
						previous?.stable?.version ??
						(kind?.type === "stable" ? previous?.version : undefined),
				});
				if (state.previousVersion !== undefined) {
					state.facts.add("previousVersion");
				}
				record({
					phase: "read-version",
					name: found.name,
					component: state.component.info.name,
					status: "ok",
					durationMs: performance.now() - start,
					reason: previous
						? `${previous.reason}${foreign ? `; ${previous.version} isn't ${scheme.name}, so this release is its first` : ""}`
						: "no previous release; every change counts",
					output: previous ?? null,
				});
				if (previous?.pending) {
					const pending = previous.pending;
					setGiven(
						state,
						{
							version: pending.version,
							...definedOnly({
								notes: pending.notes,
								kind: pending.kind,
								previousVersion: pending.previousVersion,
							}),
						},
						`releasing ${pending.version}, ${pending.reason}`,
					);
				}
			} catch (error) {
				record({
					phase: "read-version",
					name: historiesOf(state.component)
						.map(({ name }) => name)
						.join(", "),
					component: state.component.info.name,
					status: "failed",
					durationMs: performance.now() - start,
					reason: errorMessage(error),
					error,
				});
				fail(error);
			}
		}
		// A prepared release is released on its own; the rest come later.
		if (states.some((state) => state.given !== undefined)) {
			for (const state of states.filter((state) => state.given === undefined)) {
				state.live = false;
			}
		}
	}
	const publishing = states.find((state) => state.given !== undefined)?.given;

	const problems = preflight(ordered, states, publishing !== undefined);
	if (problems.length > 0) fail(new Error(problems.join("\n")));

	let bumped = publishing !== undefined;
	if (bumped) setDependencies(states);
	const skipRest = (from: number, reason: string) => {
		for (const step of ordered.slice(from)) {
			record({
				phase: step.phase,
				name: step.name,
				status: "skipped",
				durationMs: 0,
				reason,
			});
		}
	};
	const finish = (status: ReleaseStatus) => {
		const result = report(status);
		reporter?.finish?.(result);
		return result;
	};

	for (const [index, step] of ordered.entries()) {
		if (publishing !== undefined && step.phase !== "release") {
			record({
				phase: step.phase,
				name: step.name,
				status: "skipped",
				durationMs: 0,
				reason: publishing,
			});
			continue;
		}
		if (!bumped && phaseIndex(step.phase) > KIND_PHASE) {
			bumped = true;
			await bump(states, env, record, fail);
			setDependencies(states);
		}
		const live = states.filter((state) => state.live);
		if (live.length === 0) {
			skipRest(index, "no release-worthy changes");
			return finish("unchanged");
		}
		if (deferred !== undefined && step.phase === "release") {
			skipRest(index, deferred);
			return finish("pending");
		}

		const targets: (State | undefined)[] =
			step.scope === "all" ? [undefined] : live;
		for (const target of targets) {
			const start = performance.now();
			const group = target ? [target] : live;
			const component = target?.component.info.name;
			try {
				// Conditions may have skipped every step of an earlier phase.
				for (const state of group) assertEarlierPhases(state, step.phase);
				const input = target
					? { ...values(target), ...shared(env, setup.context, records) }
					: {
							components: live.map(values),
							...shared(env, setup.context, records),
						};
				const condition = step.if;
				if (condition && !condition(input)) {
					const source = condition.source;
					record({
						phase: step.phase,
						name: step.name,
						...(component !== undefined && { component }),
						status: "skipped",
						durationMs: performance.now() - start,
						reason: source
							? `\`${source}\` is false`
							: "its condition is false",
					});
					continue;
				}
				for (const state of group) assertNeeds(step, state);
				const output = await step.run(input);
				const applied = apply(step, group, target === undefined, output);
				deferred ??= applied.defer;
				record({
					phase: step.phase,
					name: step.name,
					...(component !== undefined && { component }),
					status: "ok",
					durationMs: performance.now() - start,
					reason: applied.reason,
					output,
				});
			} catch (error) {
				const message = errorMessage(error);
				record({
					phase: step.phase,
					name: step.name,
					...(component !== undefined && { component }),
					status: "failed",
					durationMs: performance.now() - start,
					reason: message,
					error,
				});
				skipRest(index + 1, `'${step.phase}' step '${step.name}' failed`);
				fail(
					error,
					`${step.phase} step '${step.name}'${component !== undefined && states.length > 1 ? ` (${component})` : ""} failed: ${message}`,
				);
			}
		}
	}
	if (!bumped) {
		await bump(states, env, record, fail);
		setDependencies(states);
	}

	if (!states.some((state) => state.live)) return finish("unchanged");
	return finish(deferred !== undefined ? "pending" : "released");
}

async function resolveSetup<Ctx>(
	setup: ReleaseSetup<Ctx>,
	env: Environment,
): Promise<ResolvedComponent[]> {
	const source = setup.components;
	const components =
		source === undefined
			? [{ name: "root" }]
			: "resolve" in source
				? await source.resolve(env)
				: source;
	const { history } = setup;
	return resolveComponents(components, {
		scheme: setup.scheme,
		history: Array.isArray(history) ? chain(history) : (history as History),
		tag: setup.tag,
	});
}

/** Histories tried in turn; the first that finds a release wins. */
function chain(histories: readonly History[]): History {
	const [only] = histories;
	if (histories.length === 1 && only) return only;
	return Object.assign(
		{
			name: histories.map(({ name }) => name).join(", "),
			find: async () => undefined,
		},
		{ chain: histories },
	);
}

function historiesOf(component: ResolvedComponent): readonly History[] {
	const history = component.history as History & {
		chain?: readonly History[];
	};
	return history.chain ?? [history];
}

/** What a history is asked, for a component. */
function historyInput(state: State, env: Environment): HistoryInput {
	return {
		env,
		component: state.component.info,
		scheme: state.component.scheme,
		tag: state.component.tag,
		channel: state.channel,
		channels: state.channels,
	};
}

async function findPrevious(
	state: State,
	env: Environment,
): Promise<{ name: string; found: Found | undefined }> {
	const histories = historiesOf(state.component);
	for (const history of histories) {
		const found = await history.find(historyInput(state, env));
		if (found) return { name: history.name, found };
	}
	return {
		name: histories.map(({ name }) => name).join(", "),
		found: undefined,
	};
}

function newState(
	component: ResolvedComponent,
	channels: Readonly<Record<string, Channel>>,
	env: Environment,
): State {
	const resolved = resolveChannels(channels, component.scheme);
	return {
		component,
		previousVersion: undefined,
		previousRef: undefined,
		previousTag: undefined,
		changes: undefined,
		kind: undefined,
		exact: undefined,
		version: undefined,
		tag: undefined,
		placeholders: undefined,
		notes: undefined,
		dependencies: [],
		releases: [],
		facts: new Set(component.scheme.traits ?? []),
		live: true,
		stable: undefined,
		channel: resolved.find(({ name }) => name === env.channel?.name),
		channels: resolved,
		given: undefined,
	};
}

/** Makes a component release a version worked out before, e.g. by a job. */
function setGiven(state: State, release: GivenRelease, reason: string) {
	const previousVersion = release.previousVersion ?? release.version;
	state.live = true;
	state.given = reason;
	state.previousVersion = previousVersion;
	state.changes = [];
	state.kind = release.kind ?? difference(previousVersion, release.version);
	state.notes = release.notes ?? "";
	const kind = classify(
		release.version,
		state.component.scheme,
		state.channels,
	);
	setVersion(
		state,
		release.version,
		kind.type === "foreign" ? release.version : kind.target,
	);
	for (const fact of CHANGE_FACTS) state.facts.add(fact);
}

/** Each live component's dependencies released along with it. */
function setDependencies(states: readonly State[]) {
	for (const state of states.filter((state) => state.live)) {
		state.dependencies = state.component.info.dependsOn.flatMap((name) => {
			const other = states.find((s) => s.component.info.name === name);
			return other?.live &&
				other.version !== undefined &&
				other.kind &&
				other.kind !== "none"
				? [
						{
							name,
							version: other.version,
							...definedOnly({ previousVersion: other.previousVersion }),
							kind: other.kind,
						},
					]
				: [];
		});
	}
}

function givenTarget(
	states: State[],
	name: string | undefined,
): State | string {
	if (name === undefined) {
		const [only] = states;
		return states.length === 1 && only
			? only
			: `there are several components (${names(states)}); say which the given release is for`;
	}
	return (
		states.find((state) => state.component.info.name === name) ??
		`'${name}' isn't a component; use ${names(states)}`
	);
}

function names(states: readonly State[]): string {
	return states.map((state) => state.component.info.name).join(", ");
}

/**
 * Sets the version, and what follows from it: the tag and placeholders. On a
 * channel, the scheme's placeholders are its target's.
 */
function setVersion(state: State, version: string, target = version) {
	const { component } = state;
	const tag = fill(component.tag, { version });
	state.version = version;
	state.tag = tag;
	state.placeholders = {
		...versionValues(target),
		...(component.scheme.matches(target)
			? component.scheme.fields?.(target)
			: {}),
		version,
		tag,
		name: component.info.name,
		...(state.channel && { channel: state.channel.name }),
	};
}

/**
 * After the last `determine-kind` step: components with nothing to release
 * drop out, and the others get their next version from their scheme, on
 * their channel if there is one.
 */
async function bump(
	states: State[],
	env: Environment,
	record: (entry: StepRecord) => void,
	fail: (error: unknown) => never,
) {
	for (const state of states.filter((state) => state.live)) {
		const start = performance.now();
		const { scheme, info } = state.component;
		const base = {
			phase: "determine-version",
			name: scheme.name,
			component: info.name,
		} as const;
		if (state.kind === undefined) {
			const error = new Error(
				"no 'determine-kind' step ran, so it has no kind",
			);
			record({
				...base,
				status: "failed",
				durationMs: 0,
				reason: error.message,
				error,
			});
			fail(error);
		}
		if (state.kind === "none") {
			state.live = false;
			record({
				...base,
				status: "skipped",
				durationMs: 0,
				reason: "no release-worthy changes",
			});
			continue;
		}
		const kind = state.kind;
		const previous = state.previousVersion;
		try {
			const next = await nextVersion(state, kind, env);
			const { version, target } = next;
			if (!scheme.matches(target)) {
				throw new Error(`${target} isn't a ${scheme.name} version`);
			}
			if (previous !== undefined) {
				const order = compareClassified(
					classify(version, scheme, state.channels),
					classify(previous, scheme, state.channels),
					scheme,
				);
				if (order <= 0) {
					throw new Error(`${version} wouldn't come after ${previous}`);
				}
			}
			setVersion(state, version, target);
			const exists = historiesOf(state.component).find((h) => h.exists);
			if (
				state.tag !== undefined &&
				(await exists?.exists?.({
					...historyInput(state, env),
					releaseTag: state.tag,
				}))
			) {
				throw new Error(
					`${state.tag} already exists; it was released from another branch`,
				);
			}
			record({
				...base,
				status: "ok",
				durationMs: performance.now() - start,
				reason:
					previous === undefined
						? `${version}: '${kind}', ${next.how}`
						: `${version}: '${kind}' from ${previous}, ${next.how}`,
				output: { version, tag: state.tag },
			});
		} catch (error) {
			record({
				...base,
				status: "failed",
				durationMs: performance.now() - start,
				reason: errorMessage(error),
				error,
			});
			fail(error);
		}
	}
}

/**
 * The next version, and the scheme's version it stands for: on a
 * prerelease channel, the next stable version's next prerelease (keeping a
 * higher target that its channel already leads up to); on a build channel,
 * the stable version's next build.
 */
async function nextVersion(
	state: State,
	kind: ReleaseKind,
	env: Environment,
): Promise<{ version: string; target: string; how: string }> {
	const { scheme } = state.component;
	const channel = state.channel;
	let target: string;
	let how: string;
	if (channel?.type === "build") {
		if (state.stable === undefined) {
			throw new Error(
				`a build on '${channel.name}' needs a previous release to number builds of`,
			);
		}
		target = state.stable;
		how = `build of ${target}`;
	} else if (state.exact !== undefined) {
		target = state.exact;
		how = "as determined";
	} else {
		const bumped = scheme.bump({
			...(state.stable !== undefined && { previous: state.stable }),
			kind,
			branch: env.branch,
			date: new Date(),
		});
		target = bumped.version;
		how = bumped.reason;
	}
	if (!channel) return { version: target, target, how };

	const previous: Classified | undefined =
		state.previousVersion === undefined
			? undefined
			: classify(state.previousVersion, scheme, state.channels);
	const onChannel =
		previous !== undefined &&
		previous.type !== "stable" &&
		previous.type !== "foreign" &&
		previous.channel === channel.name
			? previous
			: undefined;
	if (
		channel.type === "prerelease" &&
		onChannel &&
		scheme.compare(onChannel.target, target) > 0
	) {
		target = onChannel.target;
		how = `continues ${target}`;
	}
	const counter = historiesOf(state.component).find((h) => h.count);
	const counted =
		(await counter?.count?.({ ...historyInput(state, env), target })) ?? 0;
	const last =
		onChannel && scheme.compare(onChannel.target, target) === 0
			? onChannel.n
			: 0;
	const n = Math.max(counted, last) + 1;
	return {
		version: channelVersion(channel, target, n),
		target,
		how: `${how}, ${channel.name} ${n}`,
	};
}

/**
 * Checks, before anything runs, that every step's needs are met by the
 * scheme and the steps before it, naming steps that would meet them.
 */
function preflight(
	steps: readonly AnyStep[],
	states: readonly State[],
	given: boolean,
): string[] {
	const problems = new Set<string>();
	for (const state of states) {
		const facts = new Set(state.facts);
		let source: string | undefined;
		for (const step of steps) {
			if (given && step.phase !== "release") continue;
			for (const fact of step.needs ?? []) {
				if (facts.has(fact)) continue;
				const by = isChangeFact(fact)
					? source === undefined
						? "no step"
						: source
					: fact === "previousVersion"
						? undefined
						: `the scheme ${state.component.scheme.name}`;
				const providers = providersOf(fact).filter((name) => name !== source);
				const prefix =
					states.length > 1 ? `${state.component.info.name}: ` : "";
				problems.add(
					by === undefined
						? `${prefix}${step.name} needs a previous ${state.component.scheme.name} version, and there's none`
						: `${prefix}${step.name} needs ${fact}, which ${by} doesn't provide${
								providers.length > 0
									? `; ${joinOr(providers)} ${providers.length > 1 ? "do" : "does"}`
									: ""
							}`,
				);
			}
			if (step.phase === "read-changes" && !step.if) {
				for (const fact of [...facts])
					if (isChangeFact(fact)) facts.delete(fact);
				source = step.name;
			}
			for (const fact of step.provides ?? []) facts.add(fact);
		}
	}
	return [...problems];
}

function joinOr(items: readonly string[]): string {
	return items.length <= 1
		? (items[0] ?? "")
		: `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;
}

function assertNeeds(step: AnyStep, state: State) {
	const missing = (step.needs ?? []).filter((fact) => !state.facts.has(fact));
	if (missing.length > 0) {
		throw new Error(
			`it needs ${missing.join(", ")}, which no step that ran provides`,
		);
	}
}

function assertEarlierPhases(state: State, before: Phase) {
	for (const phase of PHASES.slice(0, phaseIndex(before))) {
		if (state[PHASE_VALUES[phase]] === undefined) {
			throw new Error(
				`no '${phase}' step ran, so it has no ${PHASE_VALUES[phase]}`,
			);
		}
	}
}

/** What a step receives for a component. */
function values(state: State) {
	return {
		component: state.component.info,
		...definedOnly({
			previousVersion: state.previousVersion,
			previousRef: state.previousRef,
			previousTag: state.previousTag,
			changes: state.changes,
			kind: state.kind,
			version: state.version,
			tag: state.tag,
			placeholders: state.placeholders,
			notes: state.notes,
		}),
		...(state.version !== undefined && {
			dependencies: [...state.dependencies],
		}),
		releases: [...state.releases],
	};
}

function shared(env: Environment, context: unknown, records: StepRecord[]) {
	return { env: { ...env }, context, history: [...records] };
}

/** Checks a step's output and applies it; resolves with its reason. */
function apply(
	step: AnyStep,
	group: readonly State[],
	all: boolean,
	value: unknown,
): { reason: string; defer?: string } {
	const output = checkObject(value);
	if (
		step.phase === "write" ||
		step.phase === "stage" ||
		step.phase === "release"
	) {
		checkRelease(output);
		if (step.phase !== "release" && output.defer !== undefined) {
			if (typeof output.defer !== "string" || output.defer.trim() === "") {
				throw new TypeError(
					"invalid output: 'defer' must be a non-empty string when present",
				);
			}
		}
		const result: ReleaseResult = {
			name: step.name,
			output: output.output,
			files: (output.files as string[] | undefined) ?? [],
		};
		for (const state of group) {
			state.releases.push(result);
			for (const fact of step.provides ?? []) state.facts.add(fact);
		}
		return {
			reason: output.reason as string,
			...(typeof output.defer === "string" && { defer: output.defer }),
		};
	}
	if (!all) {
		const [state] = group;
		if (state) applyTo(step, state, output);
		return { reason: output.reason as string };
	}
	const results = output.results;
	if (
		typeof results !== "object" ||
		results === null ||
		Array.isArray(results)
	) {
		throw new TypeError(
			"invalid output: 'results' must map components to their results",
		);
	}
	for (const name of Object.keys(results)) {
		if (!group.some((state) => state.component.info.name === name)) {
			throw new TypeError(
				`invalid output: '${name}' isn't a component being released`,
			);
		}
	}
	for (const state of group) {
		const own = (results as Record<string, unknown>)[state.component.info.name];
		if (own !== undefined) applyTo(step, state, checkObject(own));
	}
	return { reason: output.reason as string };
}

function applyTo(step: AnyStep, state: State, output: Record<string, unknown>) {
	switch (step.phase) {
		case "read-changes": {
			const changes = parseChanges(output);
			checkChanges(changes, step.provides ?? []);
			state.changes = changes;
			for (const fact of [...state.facts]) {
				if (isChangeFact(fact)) state.facts.delete(fact);
			}
			break;
		}
		case "determine-kind":
			if (!(KINDS as readonly unknown[]).includes(output.kind)) {
				throw new TypeError(
					`invalid output: 'kind' must be one of ${KINDS.join(", ")}`,
				);
			}
			if (
				output.version !== undefined &&
				(typeof output.version !== "string" || output.version === "")
			) {
				throw new TypeError(
					"invalid output: 'version' must be a non-empty string when present",
				);
			}
			state.kind = output.kind as Kind;
			state.exact = output.version as string | undefined;
			break;
		case "build-notes":
			if (typeof output.notes !== "string") {
				throw new TypeError("invalid output: 'notes' must be a string");
			}
			state.notes = output.notes;
			break;
	}
	for (const fact of step.provides ?? []) state.facts.add(fact);
}

/** Guards against untyped (e.g. plain JS) steps returning malformed output. */
function checkObject(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null) {
		throw new TypeError("invalid output: expected an object");
	}
	const output = value as Record<string, unknown>;
	if (typeof output.reason !== "string" || output.reason.trim() === "") {
		throw new TypeError("invalid output: 'reason' must be a non-empty string");
	}
	return output;
}

function parseChanges(output: Record<string, unknown>): Change[] {
	const changes = output.changes;
	if (
		!Array.isArray(changes) ||
		!changes.every(
			(change: unknown) =>
				typeof change === "object" &&
				change !== null &&
				typeof (change as Change).reason === "string",
		)
	) {
		throw new TypeError(
			"invalid output: 'changes' must be an array of changes, each with a 'reason'",
		);
	}
	if (
		!(changes as Change[]).every(
			({ labels }) =>
				labels === undefined ||
				(Array.isArray(labels) &&
					labels.every((label) => typeof label === "string")),
		)
	) {
		throw new TypeError(
			"invalid output: a change's 'labels' must be an array of strings when present",
		);
	}
	return changes as Change[];
}

function checkRelease(output: Record<string, unknown>) {
	if (!("output" in output)) {
		throw new TypeError(
			"invalid output: 'output' is required (use null for none)",
		);
	}
	if (
		output.files !== undefined &&
		!(
			Array.isArray(output.files) &&
			output.files.every((file) => typeof file === "string")
		)
	) {
		throw new TypeError(
			"invalid output: 'files' must be an array of paths when present",
		);
	}
}

/**
 * `breaking` or `feature` when the first or second number differs;
 * otherwise, or when either isn't a version, `fix`.
 */
function difference(from: string, to: string): ReleaseKind {
	const a = parseVersion(from);
	const b = parseVersion(to);
	const index = a && b ? firstDifference(a, b) : undefined;
	return index === 0 ? "breaking" : index === 1 ? "feature" : "fix";
}

async function detectBranch(cwd: string): Promise<string> {
	const fromCi =
		process.env.GITHUB_HEAD_REF ||
		process.env.GITHUB_REF_NAME ||
		process.env.CI_COMMIT_REF_NAME;
	if (fromCi) return fromCi;
	return (await tryGit(cwd, "rev-parse", "--abbrev-ref", "HEAD")) ?? "unknown";
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Drops `undefined` properties, for `exactOptionalPropertyTypes`. */
function definedOnly<T extends object>(
	object: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } {
	return Object.fromEntries(
		Object.entries(object).filter(([, value]) => value !== undefined),
	) as { [K in keyof T]?: Exclude<T[K], undefined> };
}
