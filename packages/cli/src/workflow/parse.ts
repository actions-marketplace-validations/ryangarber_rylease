import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { OptionsError } from "rylease";
import { isMap, isScalar, isSeq, LineCounter, parseDocument } from "yaml";

/** A workflow, as written: values keep their `${{ }}`, to evaluate later. */
export interface Workflow {
	/** Relative to the project, e.g. `.github/workflows/release.yml`. */
	file: string;
	name: string;
	/** `on`, as a map of event names to their filters (or `null`). */
	on: Record<string, unknown>;
	env: Record<string, unknown>;
	jobs: Job[];
}

export interface Job {
	id: string;
	name?: string;
	needs: string[];
	if?: unknown;
	env: Record<string, unknown>;
	/** `strategy.matrix`, still unevaluated. */
	matrix?: unknown;
	outputs: Record<string, unknown>;
	steps: WorkflowStep[];
	/** A reusable workflow the job calls instead of having steps. */
	uses?: string;
	/** Where it is, e.g. `release.yml:24`. */
	at: string;
}

export interface WorkflowStep {
	id?: string;
	name?: string;
	uses?: string;
	run?: string;
	if?: unknown;
	with: Record<string, unknown>;
	env: Record<string, unknown>;
	/** Its index in the job. */
	index: number;
	at: string;
}

/** The workflows in `.github/workflows`, sorted by file. */
export async function workflowFiles(cwd: string): Promise<string[]> {
	const directory = join(cwd, ".github/workflows");
	const names = await readdir(directory).catch(() => []);
	return names
		.filter((name) => /\.ya?ml$/.test(name))
		.sort()
		.map((name) => join(directory, name));
}

/**
 * The workflow at `path`: a file, or a name in `.github/workflows` with or
 * without `.yml`.
 */
export async function findWorkflow(cwd: string, path: string): Promise<string> {
	const candidates = [
		resolve(cwd, path),
		...[path, `${path}.yml`, `${path}.yaml`].map((name) =>
			join(cwd, ".github/workflows", name),
		),
	];
	for (const candidate of candidates) {
		if (
			await readFile(candidate).then(
				() => true,
				() => false,
			)
		)
			return candidate;
	}
	throw new OptionsError([
		`test: no workflow ${path}, in .github/workflows or otherwise`,
	]);
}

export async function readWorkflow(
	cwd: string,
	path: string,
): Promise<Workflow> {
	const file = relative(cwd, path);
	const text = await readFile(path, "utf8");
	const lines = new LineCounter();
	const doc = parseDocument(text, { lineCounter: lines, uniqueKeys: false });
	if (doc.errors.length > 0) {
		throw new OptionsError(
			doc.errors.map((error) => `${file}: ${error.message.split("\n")[0]}`),
		);
	}
	/** Where the node at `path` is, as `file:line`. */
	const at = (...path: (string | number)[]) => {
		const node = doc.getIn(path, true);
		const offset =
			(isScalar(node) || isMap(node) || isSeq(node)) && node.range
				? node.range[0]
				: 0;
		return `${basename(file)}:${lines.linePos(offset).line}`;
	};
	const value = doc.toJS({ maxAliasCount: 1000 }) as unknown;
	if (!isRecord(value))
		throw new OptionsError([`${file}: expected a workflow`]);

	const jobs = isRecord(value.jobs) ? value.jobs : {};
	return {
		file,
		name: typeof value.name === "string" ? value.name : basename(file),
		// YAML 1.1 reads a bare `on` as `true`; GitHub reads it as `on`.
		on: triggers(value.on ?? value.true),
		env: record(value.env),
		jobs: Object.entries(jobs).map(([id, raw]): Job => {
			const job = isRecord(raw) ? raw : {};
			const strategy = isRecord(job.strategy) ? job.strategy : {};
			const steps = Array.isArray(job.steps) ? job.steps : [];
			return {
				id,
				...(typeof job.name === "string" && { name: job.name }),
				needs: [job.needs ?? []].flat().map(String),
				...(job.if !== undefined && { if: job.if }),
				env: record(job.env),
				...(strategy.matrix !== undefined && { matrix: strategy.matrix }),
				outputs: record(job.outputs),
				...(typeof job.uses === "string" && { uses: job.uses }),
				at: at("jobs", id),
				steps: steps.map((raw, index): WorkflowStep => {
					const step = isRecord(raw) ? raw : {};
					return {
						...(typeof step.id === "string" && { id: step.id }),
						...(typeof step.name === "string" && { name: step.name }),
						...(typeof step.uses === "string" && { uses: step.uses }),
						...(typeof step.run === "string" && { run: step.run }),
						...(step.if !== undefined && { if: step.if }),
						with: record(step.with),
						env: record(step.env),
						index,
						at: at("jobs", id, "steps", index),
					};
				}),
			};
		}),
	};
}

/** `on` in any of its forms, as a map of events. */
function triggers(on: unknown): Record<string, unknown> {
	if (typeof on === "string") return { [on]: null };
	if (Array.isArray(on))
		return Object.fromEntries(on.map((name) => [String(name), null]));
	return isRecord(on) ? on : {};
}

function record(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {};
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** How a step names itself in output: its name, its action, or its command. */
export function stepLabel(step: WorkflowStep): string {
	if (step.name) return step.name;
	if (step.uses) return step.uses;
	const line = step.run?.trim().split("\n")[0] ?? "";
	return line
		? `run: ${line.length > 50 ? `${line.slice(0, 49)}…` : line}`
		: `step ${step.index + 1}`;
}
