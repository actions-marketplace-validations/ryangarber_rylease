import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { joinPath, OptionsError, z } from "rylease";
import { parse } from "yaml";

/** What a test run supposes about CI, beyond what's in the repository. */
export interface Mocks {
	/** The event, e.g. `workflow_dispatch`; defaults to `push`. */
	event?: string;
	/** The event's activity type, e.g. `closed` for `pull_request`. */
	type?: string;
	/** The branch or tag it's for; defaults to the checked-out branch. */
	ref?: string;
	/** For `workflow_run`: the workflow that ran; defaults to the first that triggers it. */
	workflow?: string;
	defaultBranch?: string;
	/** The event's payload, instead of one made up for it. */
	payload?: Record<string, unknown>;
	env: Record<string, string>;
	vars: Record<string, string>;
	secrets: Record<string, string>;
	inputs: Record<string, string>;
	/** Values set in `github`, by path, e.g. `github.event.workflow_run.conclusion`. */
	set: Record<string, unknown>;
	/** Outputs of jobs (`build`) and steps (`build.compile`) that can't be simulated. */
	outputs: Record<string, Record<string, string>>;
	token?: string;
}

const TEXTS = z.record(
	z.string(),
	z.union([z.string(), z.number(), z.boolean()]).transform(String),
);

const FIELDS = {
	event: z.string().optional(),
	type: z.string().optional(),
	ref: z.string().optional(),
	workflow: z.string().optional(),
	defaultBranch: z.string().optional(),
	payload: z.record(z.string(), z.unknown()).optional(),
	env: TEXTS.optional(),
	vars: TEXTS.optional(),
	secrets: TEXTS.optional(),
	inputs: TEXTS.optional(),
	set: z.record(z.string(), z.unknown()).optional(),
	outputs: z.record(z.string(), TEXTS).optional(),
	token: z.string().optional(),
};

const SCENARIO = z.strictObject(FIELDS);
const FILE = z.strictObject({
	...FIELDS,
	scenarios: z.record(z.string(), SCENARIO).optional(),
});

type Partial = z.infer<typeof SCENARIO>;

/** Where mocks are kept, when `--mocks` doesn't say. */
export const MOCKS_FILE = ".github/rylease.mocks.yml";

function emptyMocks(): Mocks {
	return { env: {}, vars: {}, secrets: {}, inputs: {}, set: {}, outputs: {} };
}

/** Later mocks win; maps are merged key by key. */
export function mergeMocks(base: Mocks, ...layers: Partial[]): Mocks {
	const result: Mocks = structuredClone(base);
	for (const layer of layers) {
		for (const key of [
			"event",
			"type",
			"ref",
			"workflow",
			"defaultBranch",
			"payload",
			"token",
		] as const) {
			if (layer[key] !== undefined)
				Object.assign(result, { [key]: layer[key] });
		}
		for (const key of ["env", "vars", "secrets", "inputs", "set"] as const) {
			Object.assign(result[key], layer[key]);
		}
		for (const [name, outputs] of Object.entries(layer.outputs ?? {})) {
			result.outputs[name] = { ...result.outputs[name], ...outputs };
		}
	}
	return result;
}

/**
 * The mocks in `path`, or {@link MOCKS_FILE} if there is one, with
 * `scenario`'s on top.
 */
export async function loadMocks(
	cwd: string,
	path: string | undefined,
	scenario: string | undefined,
): Promise<Mocks> {
	const file = resolve(cwd, path ?? MOCKS_FILE);
	const text = await readFile(file, "utf8").catch(
		(error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT" && path === undefined) return undefined;
			throw new OptionsError([`--mocks: can't read ${file}: ${error.message}`]);
		},
	);
	if (text === undefined) {
		if (scenario !== undefined) {
			throw new OptionsError([
				`--scenario: there's no ${MOCKS_FILE} to find '${scenario}' in`,
			]);
		}
		return emptyMocks();
	}
	let value: unknown;
	try {
		value = parse(text) ?? {};
	} catch (error) {
		throw new OptionsError([
			`${file}: invalid YAML: ${(error as Error).message}`,
		]);
	}
	const result = FILE.safeParse(value);
	if (!result.success) {
		throw new OptionsError(
			result.error.issues.map(
				(issue) =>
					`${file}: ${joinPath("", issue.path).replace(/^\./, "")}: ${issue.message}`,
			),
		);
	}
	const { scenarios = {}, ...defaults } = result.data;
	if (scenario !== undefined && !(scenario in scenarios)) {
		const names = Object.keys(scenarios);
		throw new OptionsError([
			`--scenario: no '${scenario}' in ${file}${names.length > 0 ? `; use ${names.join(", ")}` : ""}`,
		]);
	}
	return mergeMocks(
		emptyMocks(),
		defaults,
		scenario === undefined ? {} : (scenarios[scenario] ?? {}),
	);
}

/** `--set` values: JSON when they're JSON, e.g. `true` or `{"a":1}`, or else text. */
export function looseValue(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

/** Sets `path` (dotted, after `github.`) in `object`, making maps on the way. */
export function setPath(
	object: Record<string, unknown>,
	path: string,
	value: unknown,
): void {
	const keys = path.split(".");
	const last = keys.pop();
	if (!last) return;
	let target = object;
	for (const key of keys) {
		const next = target[key];
		if (typeof next !== "object" || next === null || Array.isArray(next))
			target[key] = {};
		target = target[key] as Record<string, unknown>;
	}
	target[last] = value;
}
