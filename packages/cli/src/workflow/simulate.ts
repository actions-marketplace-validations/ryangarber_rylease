import { isDeepStrictEqual } from "node:util";
import { errorMessage } from "rylease";
import {
	type Action,
	inputVariable,
	isRylease,
	localAction,
	looksLikeRylease,
	remoteAction,
	runAction,
} from "./action.ts";
import { type Run, resolveRef } from "./context.ts";
import {
	condition,
	ExpressionError,
	interpolate,
	interpolateAll,
	type Scope,
	toText,
} from "./expressions.ts";
import type { Mocks } from "./mocks.ts";
import {
	isRecord,
	type Job,
	stepLabel,
	type Workflow,
	type WorkflowStep,
} from "./parse.ts";
import type { Worktrees } from "./worktree.ts";

type Status = "success" | "failure" | "skipped";

export interface StepResult {
	label: string;
	/** `simulated` for rylease; `mocked` or `assumed` for the rest, which don't run. */
	kind: "simulated" | "mocked" | "assumed" | "checkout";
	status: Status;
	/** Why it was skipped or failed, or what it did. */
	reason?: string;
	outputs: Record<string, string>;
	/** For rylease: the `dry-run` the workflow gave it, which the test overrode. */
	dryRun?: string;
	summary?: string;
	at: string;
}

interface LegResult {
	label: string;
	matrix?: Record<string, unknown>;
	status: Status;
	steps: StepResult[];
}

export interface JobResult {
	id: string;
	label: string;
	status: Status;
	reason?: string;
	legs: LegResult[];
	outputs: Record<string, string>;
}

/** A read that found nothing, and where. */
export interface Missing {
	path: string;
	at: string;
}

export interface SimulationResult {
	workflow: string;
	event: string;
	jobs: JobResult[];
	missing: Missing[];
	warnings: string[];
	notes: string[];
}

/** One run of a job: the job itself, or one of its matrix's combinations. */
export interface Leg {
	job: Job;
	label: string;
	matrix?: Record<string, unknown>;
	status: "success" | "failure";
	workspace?: string;
	/** `fetch-depth` of its checkout, when it isn't the full history. */
	shallow?: number;
	steps: Record<
		string,
		{ outputs: Record<string, string>; outcome: string; conclusion: string }
	>;
	results: StepResult[];
}

export interface SimulatorOptions {
	workflow: Workflow;
	run: Run;
	mocks: Mocks;
	worktrees: Worktrees;
	/** Runs rylease steps with this engine, rather than the action they use. */
	engine?: { internal: string; index: string } | undefined;
	/** What of the environment the action's process gets, e.g. `PATH`. */
	baseEnv: Record<string, string>;
}

/** Plays a workflow's jobs, a step at a time, for a driver to show as it goes. */
export class Simulator {
	readonly options: SimulatorOptions;
	readonly #results = new Map<string, JobResult>();
	readonly #missing: Missing[] = [];
	readonly #warnings: string[] = [];
	readonly #actions = new Map<string, Promise<Action>>();

	constructor(options: SimulatorOptions) {
		this.options = options;
	}

	/** The jobs, each after those it needs. */
	order(): Job[] {
		const jobs = new Map(
			this.options.workflow.jobs.map((job) => [job.id, job]),
		);
		const ordered: Job[] = [];
		const visiting = new Set<string>();
		const visit = (job: Job) => {
			if (ordered.includes(job)) return;
			if (visiting.has(job.id))
				throw new Error(`jobs.${job.id}: its needs go in a circle`);
			visiting.add(job.id);
			for (const need of job.needs) {
				const needed = jobs.get(need);
				if (!needed)
					throw new Error(`${job.at}: needs ${need}, which isn't a job`);
				visit(needed);
			}
			visiting.delete(job.id);
			ordered.push(job);
		};
		for (const job of jobs.values()) visit(job);
		return ordered;
	}

	#scope(
		at: string,
		contexts: Record<string, unknown>,
		status?: Scope["status"],
	): Scope {
		return {
			contexts,
			...(status && { status }),
			missing: (path) => {
				if (
					!this.#missing.some((entry) => entry.path === path && entry.at === at)
				) {
					this.#missing.push({ path, at });
				}
			},
			warn: (message) => this.warn(`${at}: ${message}`),
		};
	}

	warn(message: string): void {
		if (!this.#warnings.includes(message)) this.#warnings.push(message);
	}

	/** What `needs` reads, for a job. */
	#needs(job: Job): Record<string, unknown> {
		return Object.fromEntries(
			job.needs.map((id) => {
				const result = this.#results.get(id);
				return [
					id,
					{
						result: result?.status ?? "skipped",
						outputs: result?.outputs ?? {},
					},
				];
			}),
		);
	}

	#github(job: Job): Record<string, unknown> {
		return { ...this.options.run.github, job: job.id };
	}

	/** Whether a job runs, and if so, its legs; it's skipped with a reason otherwise. */
	prepare(job: Job): { skip: string } | { fail: string } | { legs: Leg[] } {
		const { run } = this.options;
		const needs = this.#needs(job);
		const results = Object.values(needs).map(
			(need) => (need as { result: Status }).result,
		);
		const status: Scope["status"] = results.includes("failure")
			? "failure"
			: results.includes("skipped")
				? "skipped"
				: "success";
		const contexts = {
			github: this.#github(job),
			needs,
			vars: run.vars,
			inputs: run.inputs,
		};
		try {
			if (!condition(job.if, this.#scope(job.at, contexts, status))) {
				return {
					skip:
						job.if === undefined
							? `a job it needs was ${status === "failure" ? "failed" : "skipped"}`
							: `its if is false: ${String(job.if).trim()}`,
				};
			}
			const label = (matrix?: Record<string, unknown>) => {
				const name = job.name
					? toText(
							interpolate(
								job.name,
								this.#scope(job.at, { ...contexts, matrix: matrix ?? {} }),
							),
						)
					: job.id;
				return matrix && !job.name?.includes("matrix")
					? `${name} (${Object.values(matrix)
							.map((value) =>
								typeof value === "object"
									? JSON.stringify(value)
									: toText(value),
							)
							.join(", ")})`
					: name;
			};
			if (job.matrix === undefined) return { legs: [this.#leg(job, label())] };
			const matrix = interpolateAll(job.matrix, this.#scope(job.at, contexts));
			const combinations = expandMatrix(matrix);
			if (combinations.length === 0) {
				return {
					fail: "its matrix has no combinations, which fails the job in CI",
				};
			}
			return {
				legs: combinations.map((combination) =>
					this.#leg(job, label(combination), combination),
				),
			};
		} catch (error) {
			return { fail: errorMessage(error) };
		}
	}

	#leg(job: Job, label: string, matrix?: Record<string, unknown>): Leg {
		return {
			job,
			label,
			...(matrix && { matrix }),
			status: "success",
			steps: {},
			results: [],
		};
	}

	#contexts(leg: Leg, step?: WorkflowStep): Record<string, unknown> {
		const { run, workflow } = this.options;
		const { job } = leg;
		const github = {
			...this.#github(job),
			workspace: leg.workspace ?? "",
			action: step?.id ?? `__run_${(step?.index ?? 0) + 1}`,
		};
		const base = {
			github,
			needs: this.#needs(job),
			vars: run.vars,
			secrets: run.secrets,
			inputs: run.inputs,
			strategy: {
				"fail-fast": true,
				"job-index": 0,
				"job-total": 1,
				"max-parallel": 1,
			},
			matrix: leg.matrix ?? {},
			job: { status: leg.status },
			runner: {
				os: "Linux",
				arch: "X64",
				name: "GitHub Actions 1",
				environment: "github-hosted",
				temp: "/home/runner/work/_temp",
				tool_cache: "/opt/hostedtoolcache",
				debug: "",
			},
			steps: leg.steps,
		};
		// Each level's env can read the levels above it.
		let env: Record<string, unknown> = {};
		for (const [level, values] of [
			[workflow.file, workflow.env],
			[job.at, job.env],
			[step?.at ?? job.at, step?.env ?? {}],
		] as const) {
			const evaluated = interpolateAll(
				values,
				this.#scope(level, { ...base, env }),
			);
			env = { ...env, ...(isRecord(evaluated) ? evaluated : {}) };
		}
		env = { ...env, ...this.options.mocks.env };
		return { ...base, env };
	}

	/** Runs, or supposes, a step of a leg; `line` gets what it prints. */
	async step(
		leg: Leg,
		step: WorkflowStep,
		line: (text: string) => void,
	): Promise<StepResult> {
		const label = stepLabel(step);
		const finish = (
			result: Omit<StepResult, "label" | "at" | "outputs"> & {
				outputs?: Record<string, string>;
			},
		) => {
			const done: StepResult = { label, at: step.at, outputs: {}, ...result };
			if (step.id) {
				const outcome = done.status;
				leg.steps[step.id] = {
					outputs: done.outputs,
					outcome,
					conclusion: outcome,
				};
			}
			if (done.status === "failure") leg.status = "failure";
			leg.results.push(done);
			return done;
		};
		let contexts: Record<string, unknown>;
		try {
			contexts = this.#contexts(leg, step);
			if (!condition(step.if, this.#scope(step.at, contexts, leg.status))) {
				return finish({
					kind: "assumed",
					status: "skipped",
					reason:
						step.if === undefined
							? "a step before it failed"
							: `its if is false: ${String(step.if).trim()}`,
				});
			}
		} catch (error) {
			return finish({
				kind: "assumed",
				status: "failure",
				reason: errorMessage(error),
			});
		}

		const mocked = step.id
			? this.options.mocks.outputs[`${leg.job.id}.${step.id}`]
			: undefined;
		if (mocked)
			return finish({
				kind: "mocked",
				status: "success",
				reason: "outputs mocked",
				outputs: mocked,
			});

		const uses = step.uses ?? "";
		if (/^actions\/checkout@/.test(uses))
			return finish(await this.#checkout(leg, step, contexts));
		const rylease =
			looksLikeRylease(uses) ||
			(leg.workspace !== undefined &&
				uses !== "" &&
				(await isRylease(uses, leg.workspace)));
		if (!rylease) {
			return finish({
				kind: "assumed",
				status: "success",
				reason:
					step.run !== undefined
						? "not simulated; supposed to succeed"
						: `${uses} isn't simulated; supposed to succeed`,
			});
		}
		return finish(await this.#rylease(leg, step, contexts, line));
	}

	async #checkout(
		leg: Leg,
		step: WorkflowStep,
		contexts: Record<string, unknown>,
	) {
		const { run, worktrees } = this.options;
		const scope = this.#scope(step.at, contexts, leg.status);
		const options = interpolateAll(step.with, scope) as Record<string, unknown>;
		const repository = toText(options.repository);
		if (repository && repository !== run.github.repository) {
			return {
				kind: "assumed" as const,
				status: "success" as const,
				reason: `checks out ${repository}, which isn't simulated`,
			};
		}
		const ref = toText(options.ref);
		let sha = run.sha;
		if (ref !== "") {
			try {
				sha = run.refs.get(ref) ?? (await resolveRef(worktrees.cwd, ref)).sha;
			} catch {
				return {
					kind: "checkout" as const,
					status: "failure" as const,
					reason: `ref '${ref}' isn't a branch, tag or commit here`,
				};
			}
		}
		const depth =
			options["fetch-depth"] === undefined
				? 1
				: Number(toText(options["fetch-depth"]));
		if (depth !== 0) leg.shallow = depth;
		else delete leg.shallow;
		const changes = run.changes.get(sha);
		leg.workspace = await worktrees.checkout(sha, changes);
		return {
			kind: "checkout" as const,
			status: "success" as const,
			reason: `checked out ${sha.slice(0, 7)}${changes ? " with your uncommitted changes" : ""}${depth === 0 ? "" : `; in CI, only the last ${depth === 1 ? "commit" : `${depth} commits`}`}`,
		};
	}

	async #rylease(
		leg: Leg,
		step: WorkflowStep,
		contexts: Record<string, unknown>,
		line: (text: string) => void,
	) {
		const { run } = this.options;
		const uses = step.uses ?? "";
		if (!leg.workspace) {
			return {
				kind: "simulated" as const,
				status: "failure" as const,
				reason:
					"there's no actions/checkout before it; in CI, it'd find no repository",
			};
		}
		if (leg.shallow !== undefined) {
			this.warn(
				`${step.at}: the checkout before it has fetch-depth ${leg.shallow}; if it reads history, as git/tags, conventional/read-commits and github/read-pull-requests do, it fails on the shallow clone in CI, so set fetch-depth: 0`,
			);
		}
		let action: Action;
		try {
			action = await this.#action(uses, leg.workspace);
		} catch (error) {
			return {
				kind: "simulated" as const,
				status: "failure" as const,
				reason: errorMessage(error),
			};
		}
		const scope = this.#scope(step.at, contexts, leg.status);
		const given = interpolateAll(step.with, scope) as Record<string, unknown>;
		const inputs: Record<string, string> = {};
		for (const [name, value] of Object.entries(action.defaults))
			inputs[name] = toText(interpolate(value, scope));
		for (const [name, value] of Object.entries(given))
			inputs[name] = toText(value);
		const dryRun = inputs["dry-run"] ?? "false";
		inputs["dry-run"] = "true";

		const github = contexts.github as Record<string, unknown>;
		const env = contexts.env as Record<string, unknown>;
		const variables: Record<string, string> = {
			...this.options.baseEnv,
			CI: "true",
			GITHUB_ACTIONS: "true",
			GITHUB_ACTION: toText(github.action),
			GITHUB_ACTION_PATH: action.path,
			GITHUB_ACTION_REPOSITORY: uses.startsWith("./")
				? ""
				: (uses.split("@")[0] ?? ""),
			GITHUB_ACTOR: toText(github.actor),
			GITHUB_API_URL: toText(github.api_url),
			GITHUB_BASE_REF: toText(github.base_ref),
			GITHUB_EVENT_NAME: run.eventName,
			GITHUB_GRAPHQL_URL: toText(github.graphql_url),
			GITHUB_HEAD_REF: toText(github.head_ref),
			GITHUB_JOB: leg.job.id,
			GITHUB_REF: toText(github.ref),
			GITHUB_REF_NAME: toText(github.ref_name),
			GITHUB_REF_TYPE: toText(github.ref_type),
			GITHUB_REPOSITORY: toText(github.repository),
			GITHUB_REPOSITORY_OWNER: toText(github.repository_owner),
			GITHUB_RUN_ATTEMPT: toText(github.run_attempt),
			GITHUB_RUN_ID: toText(github.run_id),
			GITHUB_RUN_NUMBER: toText(github.run_number),
			GITHUB_SERVER_URL: toText(github.server_url),
			GITHUB_SHA: toText(github.sha),
			GITHUB_WORKFLOW: toText(github.workflow),
			GITHUB_WORKFLOW_REF: toText(github.workflow_ref),
			GITHUB_WORKSPACE: leg.workspace,
			RUNNER_ARCH: "X64",
			RUNNER_OS: "Linux",
			...Object.fromEntries(
				Object.entries(env).map(([name, value]) => [name, toText(value)]),
			),
			...Object.fromEntries(
				Object.entries(inputs).map(([name, value]) => [
					inputVariable(name),
					value,
				]),
			),
		};
		const result = await runAction({
			main: action.main,
			engine: this.options.engine,
			cwd: leg.workspace,
			env: variables,
			event: github.event,
			line,
		});
		const failed = result.code !== 0;
		// What it needed may be what steps that weren't run would have made.
		const unrun = leg.results.filter(
			(done) => done.kind === "assumed" && done.status === "success",
		).length;
		const hint =
			failed && unrun > 0
				? `; ${unrun === 1 ? "a step before it wasn't run" : `${unrun} steps before it weren't run`}, so it may fail only here, for want of what ${unrun === 1 ? "it makes" : "they make"}`
				: "";
		return {
			kind: "simulated" as const,
			status: failed ? ("failure" as const) : ("success" as const),
			reason: `${failed ? `failed (exit ${result.code})` : (result.outputs.status ?? "done")}, by ${this.options.engine ? "this rylease" : action.label}${hint}`,
			outputs: result.outputs,
			dryRun,
			summary: result.summary,
		};
	}

	#action(uses: string, workspace: string): Promise<Action> {
		if (uses.startsWith("./")) return localAction(uses, workspace);
		let action = this.#actions.get(uses);
		if (!action) {
			action = remoteAction(uses);
			this.#actions.set(uses, action);
		}
		return action;
	}

	/** Records a job's result, with its outputs, for the jobs that need it. */
	finish(
		job: Job,
		outcome: { skip: string } | { fail: string } | { legs: Leg[] },
	): JobResult {
		const mocked = this.options.mocks.outputs[job.id] ?? {};
		let result: JobResult;
		if ("skip" in outcome || "fail" in outcome) {
			result = {
				id: job.id,
				label: job.name ?? job.id,
				status: "skip" in outcome ? "skipped" : "failure",
				reason: "skip" in outcome ? outcome.skip : outcome.fail,
				legs: [],
				outputs: "skip" in outcome ? {} : mocked,
			};
		} else {
			const outputs: Record<string, string> = {};
			for (const leg of outcome.legs) {
				const scope = this.#scope(job.at, this.#contexts(leg));
				for (const [name, value] of Object.entries(job.outputs)) {
					try {
						outputs[name] = toText(interpolate(String(value), scope));
					} catch (error) {
						if (!(error instanceof ExpressionError)) throw error;
						this.warn(`${job.at}: outputs.${name}: ${error.message}`);
					}
				}
			}
			const status = outcome.legs.some((leg) => leg.status === "failure")
				? "failure"
				: "success";
			result = {
				id: job.id,
				label: job.name ?? job.id,
				status,
				...(job.uses !== undefined && {
					reason: `calls ${job.uses}, which isn't simulated`,
				}),
				legs: outcome.legs.map((leg) => ({
					label: leg.label,
					...(leg.matrix && { matrix: leg.matrix }),
					status: leg.status,
					steps: leg.results,
				})),
				outputs: { ...outputs, ...mocked },
			};
		}
		this.#results.set(job.id, result);
		return result;
	}

	result(): SimulationResult {
		const { run, workflow } = this.options;
		return {
			workflow: workflow.file,
			event: run.eventName,
			jobs: [...this.#results.values()],
			missing: this.#missing,
			warnings: this.#warnings,
			notes: run.notes,
		};
	}
}

/**
 * A matrix's combinations, as GitHub makes them: every combination of its
 * vectors, less those `exclude` matches, with `include` added to those it
 * doesn't contradict, or as a combination of its own.
 */
export function expandMatrix(matrix: unknown): Record<string, unknown>[] {
	if (!isRecord(matrix)) throw new Error("matrix: expected a map of vectors");
	const { include = [], exclude = [], ...vectors } = matrix;
	const keys = Object.keys(vectors);
	let combinations: Record<string, unknown>[] = keys.length === 0 ? [] : [{}];
	for (const [key, values] of Object.entries(vectors)) {
		if (!Array.isArray(values))
			throw new Error(`matrix.${key}: expected a list`);
		combinations = combinations.flatMap((combination) =>
			values.map((value) => ({ ...combination, [key]: value })),
		);
	}
	const matches = (combination: Record<string, unknown>, pattern: unknown) =>
		isRecord(pattern) &&
		Object.entries(pattern).every(([key, value]) =>
			isDeepStrictEqual(combination[key], value),
		);
	combinations = combinations.filter(
		(combination) =>
			![exclude].flat().some((pattern) => matches(combination, pattern)),
	);
	const extra: Record<string, unknown>[] = [];
	for (const addition of [include].flat()) {
		if (!isRecord(addition))
			throw new Error("matrix.include: expected a list of maps");
		let added = false;
		for (const combination of combinations) {
			const fits = Object.entries(addition).every(
				([key, value]) =>
					!keys.includes(key) || isDeepStrictEqual(combination[key], value),
			);
			if (fits) {
				Object.assign(combination, addition);
				added = true;
			}
		}
		if (!added) extra.push({ ...addition });
	}
	return [...combinations, ...extra];
}
