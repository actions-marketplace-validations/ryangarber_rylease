import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import { defineRelease } from "../core/define.ts";
import type { ReleaseReport, RunOptions } from "../core/engine.ts";
import { errorMessage } from "../core/engine.ts";
import { OptionsError } from "../core/options.ts";
import { resolveWorkflow, type WorkflowInput } from "./workflow.ts";

/** Where a config is looked for, in order, relative to the project. */
const CONFIG_FILES = [
	"rylease.config.ts",
	"rylease.config.mts",
	"rylease.config.js",
	"rylease.config.mjs",
	"rylease.yml",
	"rylease.yaml",
	".github/rylease.yml",
	".github/rylease.yaml",
];

/** A release that can be run, whatever its context. */
export interface Runnable {
	run(options?: RunOptions): Promise<ReleaseReport>;
}

/**
 * A config: a release defined in TypeScript or JavaScript, or the same keys
 * as the GitHub Action's inputs, from YAML or a plain object.
 */
type Config =
	| { path: string; release: Runnable }
	| { path: string; input: WorkflowInput };

/**
 * Loads the config at `path`, or the first of {@link CONFIG_FILES} there is;
 * `undefined` when there's none.
 */
async function loadConfig(
	cwd: string,
	path?: string,
): Promise<Config | undefined> {
	const file = path
		? resolve(cwd, path)
		: await firstExisting(CONFIG_FILES.map((name) => resolve(cwd, name)));
	if (file === undefined) return undefined;
	if (/\.ya?ml$/.test(file)) {
		const text = await readFile(file, "utf8").catch((error: unknown) => {
			throw new OptionsError([
				`config: can't read ${file}: ${errorMessage(error)}`,
			]);
		});
		let value: unknown;
		try {
			value = parse(text);
		} catch (error) {
			throw new OptionsError([
				`config: invalid YAML in ${file}: ${errorMessage(error)}`,
			]);
		}
		return { path: file, input: workflowInput(value, file) };
	}
	const module = (await import(pathToFileURL(file).href)) as {
		default?: unknown;
	};
	const value = module.default;
	if (isRelease(value)) return { path: file, release: value };
	const input = workflowInput(value, file);
	// Steps made in code run as they are; names from YAML-like configs are loaded.
	const made = Array.isArray(input.steps) && input.steps.some(isStep);
	return made
		? { path: file, release: defineRelease(input as never) }
		: { path: file, input };
}

const KEYS = ["steps", "scheme", "tag", "history", "components", "channels"];

function workflowInput(value: unknown, file: string): WorkflowInput {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new OptionsError([
			`config: ${file} must hold a map of ${KEYS.join(", ")}, or export a release made with defineRelease`,
		]);
	}
	const unknown = Object.keys(value).filter((key) => !KEYS.includes(key));
	if (unknown.length > 0) {
		throw new OptionsError(
			unknown.map(
				(key) => `config.${key}: unknown key; use ${KEYS.join(", ")}`,
			),
		);
	}
	return value as WorkflowInput;
}

function isRelease(value: unknown): value is Runnable {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as Partial<Runnable>).run === "function"
	);
}

function isStep(value: unknown): boolean {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { run?: unknown }).run === "function"
	);
}

async function firstExisting(
	paths: readonly string[],
): Promise<string | undefined> {
	for (const path of paths) {
		if (
			await access(path).then(
				() => true,
				() => false,
			)
		)
			return path;
	}
	return undefined;
}

/**
 * The release to run: the config's, with any of its keys given here instead,
 * e.g. by the action's inputs; without a config or `steps`, the
 * `conventional` preset.
 */
export async function configuredRelease(
	cwd: string,
	path: string | undefined,
	overrides: Partial<WorkflowInput>,
): Promise<Runnable> {
	const config = await loadConfig(cwd, path);
	const given = Object.entries(overrides).filter(
		([, value]) => value !== undefined,
	);
	if (config && "release" in config) {
		if (given.length > 0) {
			throw new OptionsError(
				given.map(
					([key]) =>
						`${key}: ${config.path} defines the release; set ${key} there`,
				),
			);
		}
		return config.release;
	}
	const input: WorkflowInput = {
		steps: [{ uses: "conventional" }],
		...config?.input,
		...Object.fromEntries(given),
	};
	return defineRelease(await resolveWorkflow(input, { cwd }));
}
