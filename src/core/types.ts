import type { RunChannel } from "./channels.ts";
import type { ChangeWith, Fact, Narrow, ProvidedOutput } from "./facts.ts";
import type { History } from "./history.ts";
import type { Scheme } from "./scheme.ts";

/** Every step type, in the order the engine runs them. */
export const PHASES = [
	"read-changes",
	"determine-kind",
	"build-notes",
	"prepare",
	"commit",
	"release",
] as const;

export type StepType = (typeof PHASES)[number];

/**
 * How much a release changes, whatever the version scheme: the scheme decides
 * what each kind bumps, e.g. semver's `MAJOR.minor.patch`.
 */
export const KINDS = ["breaking", "feature", "fix", "none"] as const;

export type Kind = (typeof KINDS)[number];

/** A kind that actually produces a release; `none` releases nothing. */
export type ReleaseKind = Exclude<Kind, "none">;

/** A single, source-agnostic change (a commit section, an issue, a PR, ...). */
export interface Change {
	title?: string;
	description?: string;
	/** Where this change came from, e.g. `commit aefc3af`. */
	reason: string;
	/** Where to read more, e.g. `{ label: "aefc3af", url: ".../commit/aefc3af..." }`. */
	link?: { label: string; url: string };
	/**
	 * How the source categorized it, e.g. a pull request's labels, or the
	 * `### Fixed` section of a changelog.
	 */
	labels?: string[];
}

/**
 * A versioned unit, as steps see it: one package, a Go module, a Docker
 * image, or several packages released together under one version.
 */
export interface ComponentInfo {
	name: string;
	/** Its directory, relative to `env.cwd`; `.` for the whole project. */
	path: string;
	/** Components it depends on, by name; they're released first. */
	dependsOn: readonly string[];
	/**
	 * Pathspecs for git: its directory, without the directories of components
	 * inside it. Empty when every path counts.
	 */
	pathspec: readonly string[];
}

export interface ChangesOutput {
	changes: Change[];
	/** e.g. `6 changes in 4 commits since 1a2b3c4`. */
	reason: string;
}

export interface KindOutput {
	kind: Kind;
	/**
	 * Releases exactly this version instead of bumping by the kind, e.g. from
	 * a `Release-As:` footer. It must be valid in the scheme, and later than
	 * the previous version.
	 */
	version?: string;
	/** e.g. `'feat!' in title (commit aefc3af)`. */
	reason: string;
}

export interface NotesOutput {
	notes: string;
	/** e.g. `feature release, 3 features, 1 fix`. */
	reason: string;
}

export interface ReleaseOutput {
	output: unknown;
	/** Files the step changed (or would change in a dry run), relative to `cwd`. */
	files?: string[];
	/** e.g. `wrote 1.3.0 to package.json`. */
	reason: string;
}

/** What `prepare` and `commit` steps return. */
export interface PrepareOutput extends ReleaseOutput {
	/**
	 * Leaves the release to later, e.g. once a release pull request merges:
	 * every `release` step is skipped with this reason, and the run is
	 * `pending`.
	 */
	defer?: string;
}

/** What each step type must return. */
export interface StepOutputs {
	"read-changes": ChangesOutput;
	"determine-kind": KindOutput;
	"build-notes": NotesOutput;
	prepare: PrepareOutput;
	commit: PrepareOutput;
	release: ReleaseOutput;
}

/** The output of a prior `prepare` or `release` step, as later ones see it. */
export interface ReleaseResult {
	name: string;
	output: unknown;
	files: readonly string[];
}

/** Where a component's release starts from; found before any step runs. */
export interface Previous {
	component: ComponentInfo;
	/** Absent on a first release, or when the scheme changed since the last one. */
	previousVersion?: string;
	/** The commit of the previous release; changes are collected since it. */
	previousRef?: string;
	/** The tag of the previous release, when it was found by its tag. */
	previousTag?: string;
}

/** The release being made, from `build-notes` on. */
export interface Next {
	kind: ReleaseKind;
	version: string;
	/** The release's tag, e.g. `v1.2.0`. */
	tag: string;
	/**
	 * Values for `{placeholders}` in templates: `version`, `tag`, `name`, and
	 * the scheme's own, e.g. semver's `major`, `minor` and `patch`.
	 */
	placeholders: Readonly<Record<string, string>>;
	/** The components it depends on that are released along with it. */
	dependencies: readonly Dependency[];
}

/** A dependency released along with a component. */
export interface Dependency {
	name: string;
	version: string;
	previousVersion?: string;
	kind: ReleaseKind;
}

/**
 * What a step receives for one component, by type. Values from earlier phases
 * are always present; the value of a step's own phase is only present when
 * an earlier step of the same type already ran.
 */
export interface StepResults {
	"read-changes": Previous & { changes?: Change[] };
	"determine-kind": Previous & { changes: Change[]; kind?: Kind };
	"build-notes": Previous & Next & { changes: Change[]; notes?: string };
	prepare: Previous &
		Next & {
			changes: Change[];
			notes: string;
			releases: readonly ReleaseResult[];
		};
	commit: StepResults["prepare"];
	release: StepResults["prepare"];
}

export interface Environment {
	/** Root directory of the project being released. */
	cwd: string;
	/** Current branch name. */
	branch: string;
	/** When set, steps must not cause side effects. */
	dryRun: boolean;
	/** The channel being released on; absent for a stable release. */
	channel?: RunChannel;
}

/**
 * How a step runs: once per component (`each`, the default), or once with
 * every component (`all`), e.g. to commit or push their releases together.
 */
export type Scope = "each" | "all";

export type StepStatus = "ok" | "skipped" | "failed";

/** What the engine itself records: the previous version, and the next. */
export type EngineRecordType = "previous" | "version";

/** The audit record of a single step, or of the engine's own work. */
export interface StepRecord {
	type: StepType | EngineRecordType;
	name: string;
	/** The component it ran for; absent for `all` steps. */
	component?: string;
	status: StepStatus;
	durationMs: number;
	reason: string;
	output?: unknown;
	error?: unknown;
}

interface Shared<Ctx> {
	env: Environment;
	/** User-defined state shared by every step. Never used by bundled steps. */
	context: Ctx;
	/** Records of every step that ran before this one. */
	history: readonly StepRecord[];
}

/** What a step receives, for one component. */
export type StepInput<
	T extends StepType,
	Ctx = unknown,
	N extends Fact = never,
> = Narrow<StepResults[T], N> & Shared<Ctx>;

/** What an `all` step receives: every component that's still releasing. */
export type AllStepInput<
	T extends StepType,
	Ctx = unknown,
	N extends Fact = never,
> = { components: readonly Narrow<StepResults[T], N>[] } & Shared<Ctx>;

/** What a step returns, for one component. */
export type StepOutput<
	T extends StepType,
	P extends Fact = never,
> = ProvidedOutput<StepOutputs[T], P>;

/**
 * What an `all` step returns: in `prepare` and `release`, one result for all of them;
 * otherwise a result per component, by name, leaving out those it doesn't
 * change.
 */
export type AllStepOutput<
	T extends StepType,
	P extends Fact = never,
> = T extends "release"
	? ReleaseOutput
	: T extends "prepare" | "commit"
		? PrepareOutput
		: {
				results: Partial<Record<string, StepOutput<T, P>>>;
				reason: string;
			};

/**
 * Whether a step runs, decided just before it would, from what it would
 * receive. `source` describes it in reports, e.g. the expression it came from.
 */
export interface StepCondition<I> {
	(input: I): boolean;
	readonly source?: string;
}

interface StepBase<T extends StepType> {
	type: T;
	name: string;
	/** Facts the step relies on, e.g. `changes.labels`; checked before anything runs. */
	needs?: readonly Fact[];
	/** Facts the step guarantees, e.g. that every change has `labels`; checked on its output. */
	provides?: readonly Fact[];
	/** The preset that made the step, with the scheme and history it provides. */
	preset?: StepPreset;
}

/** A preset, as the steps it makes carry it. */
export interface StepPreset {
	name: string;
	scheme?: Scheme;
	history?: History | readonly History[];
}

export interface EachStepDefinition<T extends StepType, Ctx = unknown>
	extends StepBase<T> {
	scope?: "each";
	/** When set, the step only runs if this returns true; otherwise it's skipped. */
	if?: StepCondition<StepInput<T, Ctx>>;
	run: (input: StepInput<T, Ctx>) => StepOutputs[T] | Promise<StepOutputs[T]>;
}

export interface AllStepDefinition<T extends StepType, Ctx = unknown>
	extends StepBase<T> {
	scope: "all";
	/** When set, the step only runs if this returns true; otherwise it's skipped. */
	if?: StepCondition<AllStepInput<T, Ctx>>;
	run: (
		input: AllStepInput<T, Ctx>,
	) => AllStepOutput<T> | Promise<AllStepOutput<T>>;
}

export type StepDefinition<T extends StepType, Ctx = unknown> =
	| EachStepDefinition<T, Ctx>
	| AllStepDefinition<T, Ctx>;

/** Any step, discriminated by `type` and `scope`. */
export type Step<Ctx = unknown> = {
	[T in StepType]: StepDefinition<T, Ctx>;
}[StepType];

export type { ChangeWith, Fact };
