import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isCancel, select } from "@clack/prompts";
import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { multiple, optional } from "@optique/core/modifiers";
import type { InferValue } from "@optique/core/parser";
import {
	argument,
	command,
	constant,
	flag,
	option,
} from "@optique/core/primitives";
import { choice, keyValue, string } from "@optique/core/valueparser";
import { Listr, type ListrTask } from "listr2";
import { git, OptionsError, tryGit } from "rylease";
import type { Io } from "../io.ts";
import { looksLikeRylease } from "../workflow/action.ts";
import { makeRun, type Run } from "../workflow/context.ts";
import {
	loadMocks,
	looseValue,
	MOCKS_FILE,
	type Mocks,
	mergeMocks,
} from "../workflow/mocks.ts";
import {
	findWorkflow,
	isRecord,
	readWorkflow,
	stepLabel,
	type Workflow,
	workflowFiles,
} from "../workflow/parse.ts";
import { cleanLine, stepLine, summaryText } from "../workflow/report.ts";
import {
	type Leg,
	type SimulationResult,
	Simulator,
} from "../workflow/simulate.ts";
import { triggers } from "../workflow/triggers.ts";
import { Worktrees } from "../workflow/worktree.ts";
import { jsonValue } from "./release.ts";

const pairs = (
	name: `--${string}`,
	metavar: `${string}=${string}`,
	description: ReturnType<typeof message>,
) =>
	multiple(
		option(name, keyValue({ metavar }), {
			description,
		}),
	);

export const testCommand = command(
	"test",
	object({
		command: constant("test"),
		workflow: optional(
			argument(string({ metavar: "WORKFLOW" }), {
				description: message`A file in .github/workflows, with or without .yml; defaults to the one with rylease in it`,
			}),
		),
		event: optional(
			option("--event", string({ metavar: "NAME" }), {
				description: message`The event, e.g. workflow_dispatch; defaults to push`,
			}),
		),
		type: optional(
			option("--type", string({ metavar: "TYPE" }), {
				description: message`The event's activity type, e.g. closed`,
			}),
		),
		ref: optional(
			option("--ref", string({ metavar: "REF" }), {
				description: message`The branch or tag it's for; defaults to the checked-out branch`,
			}),
		),
		defaultBranch: optional(
			option("--default-branch", string({ metavar: "NAME" }), {
				description: message`Defaults to origin's`,
			}),
		),
		after: optional(
			option("--after", string({ metavar: "WORKFLOW" }), {
				description: message`For workflow_run, the workflow that ran; defaults to the first it runs after`,
			}),
		),
		payload: optional(
			option("--payload", string({ metavar: "FILE" }), {
				description: message`The event's payload, as JSON, instead of a made-up one`,
			}),
		),
		mocks: optional(
			option("--mocks", string({ metavar: "FILE" }), {
				description: message`Mocks to use; defaults to ${MOCKS_FILE}, if there is one`,
			}),
		),
		scenario: optional(
			option("--scenario", string({ metavar: "NAME" }), {
				description: message`One of the mocks' scenarios`,
			}),
		),
		env: pairs(
			"--env",
			"NAME=VALUE",
			message`An env value, over the workflow's`,
		),
		vars: pairs("--var", "NAME=VALUE", message`A configuration variable`),
		secrets: pairs("--secret", "NAME=VALUE", message`A secret`),
		inputs: pairs("--input", "NAME=VALUE", message`A workflow_dispatch input`),
		set: pairs(
			"--set",
			"PATH=VALUE",
			message`A value in github, e.g. github.actor=me; JSON is read as JSON`,
		),
		outputs: pairs(
			"--output",
			"JOB[.STEP].NAME=VALUE",
			message`An output of a job or step that isn't simulated`,
		),
		token: optional(
			option("--token", string({ metavar: "TOKEN" }), {
				description: message`github.token, for steps that read from GitHub`,
			}),
		),
		ghToken: optional(
			flag("--gh-token", {
				description: message`Use gh auth token as github.token`,
			}),
		),
		engine: optional(
			option("--engine", choice(["action", "local"]), {
				description: message`Run the action the workflow uses (the default), or this rylease`,
			}),
		),
		committed: optional(
			flag("--committed", {
				description: message`Leave out uncommitted changes`,
			}),
		),
		force: optional(
			flag("--force", {
				description: message`Run the jobs even if the event wouldn't trigger the workflow`,
			}),
		),
		keep: optional(
			flag("--keep", {
				description: message`Keep the jobs' checkouts, to look at`,
			}),
		),
		json: optional(
			flag("--json", {
				description: message`Print the result as JSON`,
			}),
		),
		cwd: optional(
			option("--cwd", string({ metavar: "DIR" }), {
				description: message`The project; defaults to the working directory`,
			}),
		),
	}),
	{
		brief: message`Test a release workflow locally, as a dry run`,
		description: message`Plays a GitHub Actions workflow for an event, without Docker: evaluates its triggers, if: conditions and expressions, and runs each rylease step as CI would, in a fresh checkout, always as a dry run. Other steps aren't run; mock their outputs. Each job's outputs feed the jobs that need them.`,
	},
);

type Values = InferValue<typeof testCommand>;

export async function test(values: Values, io: Io): Promise<number> {
	const cwd = await repositoryRoot(resolve(io.cwd, values.cwd ?? "."));
	const mocks = await flagMocks(
		values,
		cwd,
		await loadMocks(cwd, values.mocks, values.scenario),
	);
	const workflow = await readWorkflow(
		cwd,
		await chooseWorkflow(cwd, values.workflow, io),
	);
	const worktrees = new Worktrees(cwd);
	const color = io.interactive === true && !values.json;
	try {
		const snapshot = values.committed ? undefined : await worktrees.snapshot();
		const run = await makeRun({ cwd, workflow, mocks, snapshot });
		const triggered = await triggers(workflow.on, eventOf(run, cwd));
		const simulator = new Simulator({
			workflow,
			run,
			mocks,
			worktrees,
			engine: values.engine === "local" ? localEngine() : undefined,
			baseEnv: baseEnv(),
		});

		if (!values.json) {
			io.write(
				`${workflow.file} on ${run.eventName} (${String(run.github.ref)} at ${run.sha.slice(0, 7)}): ${triggered.reason}\n`,
			);
		}
		if (!triggered.fires && !values.force) {
			if (values.json)
				io.write(
					`${JSON.stringify({ workflow: workflow.file, triggered }, null, 2)}\n`,
				);
			else io.write("Nothing runs; pass --force to run its jobs anyway.\n");
			return 0;
		}
		if (values.json) await plain(simulator, () => {}, false);
		else if (color) await fancy(simulator);
		else await plain(simulator, io.write, color);

		const result = simulator.result();
		if (values.json) {
			io.write(`${JSON.stringify({ ...result, triggered }, jsonValue, 2)}\n`);
		} else {
			io.write(summaryText(result, values.mocks ?? MOCKS_FILE));
			if (values.keep && worktrees.paths.length > 0) {
				io.write(
					`\nKept the checkouts:\n${worktrees.paths.map((path) => `  ${path}\n`).join("")}`,
				);
			}
		}
		return failed(result) ? 1 : 0;
	} finally {
		if (!values.keep) await worktrees.remove();
	}
}

function failed(result: SimulationResult): boolean {
	return result.jobs.some((job) => job.status === "failure");
}

/** Each job, a line per step, and what rylease steps print, indented. */
async function plain(
	simulator: Simulator,
	write: (text: string) => void,
	color: boolean,
): Promise<void> {
	for (const job of simulator.order()) {
		const outcome = simulator.prepare(job);
		if (!("legs" in outcome)) {
			const done = simulator.finish(job, outcome);
			write(
				`\n${done.status === "skipped" ? "○" : "✖"} ${done.label}: ${done.status === "skipped" ? "skipped, " : ""}${done.reason}\n`,
			);
			continue;
		}
		for (const leg of outcome.legs) {
			write(`\n● ${leg.label}\n`);
			for (const step of job.steps) {
				let printed = false;
				const done = await simulator.step(leg, step, (line) => {
					const text = cleanLine(line, color);
					if (!printed) write(`  ▸ ${stepLabel(step)}\n`);
					printed = true;
					write(text.trim() === "" ? "\n" : `      ${text}\n`);
				});
				write(`  ${stepLine(done)}\n`);
			}
		}
		const done = simulator.finish(job, outcome);
		if (job.uses) write(`  · ${done.reason}\n`);
	}
}

/** The same, as a live tree of tasks. */
async function fancy(simulator: Simulator): Promise<void> {
	const steps = (leg: Leg): ListrTask[] =>
		leg.job.steps.map((step) => ({
			title: stepLabel(step),
			task: async (_, task) => {
				const done = await simulator.step(leg, step, (line) => {
					task.output = cleanLine(line, true);
				});
				task.title = stepLine(done).slice(2);
				if (done.status === "skipped") task.skip(task.title);
				if (done.status === "failure") throw new Error(task.title);
			},
			rendererOptions: {
				persistentOutput: true,
				outputBar: Number.POSITIVE_INFINITY,
			},
		}));
	const jobs: ListrTask[] = simulator.order().map((job) => ({
		title: job.name ?? job.id,
		task: (_, task) => {
			const outcome = simulator.prepare(job);
			if (!("legs" in outcome)) {
				const done = simulator.finish(job, outcome);
				if (done.status === "skipped")
					return task.skip(`${task.title}: skipped, ${done.reason}`);
				throw new Error(`${task.title}: ${done.reason}`);
			}
			const [only] = outcome.legs;
			const legs: ListrTask[] =
				outcome.legs.length === 1 && only && !only.matrix
					? steps(only)
					: outcome.legs.map(
							(leg): ListrTask => ({
								title: leg.label,
								task: (_, legTask) =>
									legTask.newListr(steps(leg), { exitOnError: false }),
							}),
						);
			return task.newListr(
				[
					...legs,
					// Untitled, so not shown: the job's outputs, once its legs are done.
					{ task: () => void simulator.finish(job, outcome) },
				],
				{ exitOnError: false },
			);
		},
	}));
	await new Listr(jobs, {
		exitOnError: false,
		rendererOptions: { collapseSubtasks: false, collapseSkips: false },
	}).run();
}

/** The repository's top, where `.github` is. */
async function repositoryRoot(cwd: string): Promise<string> {
	const root = await tryGit(cwd, "rev-parse", "--show-toplevel");
	if (!root) throw new OptionsError([`test: ${cwd} isn't in a Git repository`]);
	return root;
}

async function chooseWorkflow(
	cwd: string,
	given: string | undefined,
	io: Io,
): Promise<string> {
	if (given !== undefined) return findWorkflow(cwd, given);
	const files = await workflowFiles(cwd);
	const candidates: string[] = [];
	for (const file of files) {
		const workflow = await readWorkflow(cwd, file).catch(() => undefined);
		if (workflow && usesRylease(workflow)) candidates.push(file);
	}
	if (candidates.length === 1 && candidates[0]) return candidates[0];
	if (candidates.length === 0) {
		throw new OptionsError([
			files.length === 0
				? "test: there are no workflows in .github/workflows"
				: "test: no workflow in .github/workflows uses rylease; name the one to test",
		]);
	}
	if (!io.interactive) {
		throw new OptionsError([
			`test: several workflows use rylease; name one of ${candidates.map((file) => file.split("/").pop()).join(", ")}`,
		]);
	}
	const chosen = await select({
		message: "Which workflow?",
		options: candidates.map((file) => ({
			value: file,
			label: file.split("/").pop() ?? file,
		})),
	});
	if (isCancel(chosen)) throw new OptionsError(["test: cancelled"]);
	return chosen;
}

function usesRylease(workflow: Workflow): boolean {
	return workflow.jobs.some((job) =>
		job.steps.some(
			(step) =>
				step.uses !== undefined &&
				(looksLikeRylease(step.uses) || step.uses.startsWith("./")),
		),
	);
}

/** Mocks from flags, over the file's. */
async function flagMocks(
	values: Values,
	cwd: string,
	mocks: Mocks,
): Promise<Mocks> {
	const record = (entries: readonly (readonly [string, string])[]) =>
		Object.fromEntries(entries);
	const outputs: Record<string, Record<string, string>> = {};
	for (const [path, value] of values.outputs) {
		const at = path.lastIndexOf(".");
		if (at <= 0)
			throw new OptionsError([
				`--output ${path}: expected JOB.NAME or JOB.STEP.NAME`,
			]);
		const owner = path.slice(0, at);
		outputs[owner] = { ...outputs[owner], [path.slice(at + 1)]: value };
	}
	let payload: Record<string, unknown> | undefined;
	if (values.payload) {
		const text = await readFile(resolve(cwd, values.payload), "utf8").catch(
			(error: Error) => {
				throw new OptionsError([
					`--payload: can't read ${values.payload}: ${error.message}`,
				]);
			},
		);
		const parsed = looseValue(text);
		if (!isRecord(parsed))
			throw new OptionsError([
				`--payload: ${values.payload} isn't a JSON object`,
			]);
		payload = parsed;
	}
	const token = values.token ?? (values.ghToken ? await ghToken() : undefined);
	return mergeMocks(mocks, {
		...(values.event !== undefined && { event: values.event }),
		...(values.type !== undefined && { type: values.type }),
		...(values.ref !== undefined && { ref: values.ref }),
		...(values.after !== undefined && { workflow: values.after }),
		...(values.defaultBranch !== undefined && {
			defaultBranch: values.defaultBranch,
		}),
		...(payload && { payload }),
		...(token !== undefined && { token }),
		env: record(values.env),
		vars: record(values.vars),
		secrets: record(values.secrets),
		inputs: record(values.inputs),
		set: Object.fromEntries(
			values.set.map(([path, value]) => [path, looseValue(value)]),
		),
		outputs,
	});
}

function ghToken(): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile("gh", ["auth", "token"], (error, stdout) =>
			error
				? reject(
						new OptionsError([
							"--gh-token: gh auth token failed; is gh logged in?",
						]),
					)
				: resolve(stdout.trim()),
		);
	});
}

/** The event, as `on:` filters see it. */
function eventOf(run: Run, cwd: string) {
	const { github } = run;
	const event = isRecord(github.event) ? github.event : {};
	const workflowRun = isRecord(event.workflow_run) ? event.workflow_run : {};
	const workflow = isRecord(event.workflow) ? event.workflow : {};
	return {
		name: run.eventName,
		type: typeof event.action === "string" ? event.action : undefined,
		ref: String(github.ref),
		...(github.base_ref ? { baseRef: String(github.base_ref) } : {}),
		...(typeof workflow.name === "string" && { workflow: workflow.name }),
		...(typeof workflowRun.head_branch === "string" && {
			headBranch: workflowRun.head_branch,
		}),
		changedFiles: async () => {
			const pull = isRecord(event.pull_request)
				? event.pull_request
				: undefined;
			const base =
				pull && isRecord(pull.base)
					? String(pull.base.sha)
					: typeof event.before === "string"
						? event.before
						: undefined;
			const head =
				pull && isRecord(pull.head) ? String(pull.head.sha) : run.sha;
			if (!base || /^0+$/.test(base)) return [];
			const range = pull ? `${base}...${head}` : `${base}..${head}`;
			return (await git(cwd, "diff", "--name-only", range))
				.split("\n")
				.filter(Boolean);
		},
	};
}

/** The local rylease's modules, to run steps with instead of the workflow's action. */
function localEngine(): { internal: string; index: string } {
	return {
		internal: import.meta.resolve("rylease/internal"),
		index: import.meta.resolve("rylease"),
	};
}

/** What of this environment steps get: enough to run, but nothing of CI's or secrets. */
function baseEnv(): Record<string, string> {
	const names = [
		"PATH",
		"HOME",
		"TMPDIR",
		"TEMP",
		"TMP",
		"LANG",
		"LC_ALL",
		"TERM",
		"SHELL",
		"USER",
		"LOGNAME",
		"SYSTEMROOT",
		"APPDATA",
	];
	return Object.fromEntries(
		names.flatMap((name) =>
			process.env[name] === undefined
				? []
				: [[name, process.env[name] as string]],
		),
	);
}
