import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { AnyStepFactory, Preset } from "./define.ts";
import { joinPath, OptionsError } from "./options.ts";
import * as presets from "./presets/index.ts";
import * as steps from "./steps/index.ts";
import { PHASES, type Step } from "./types.ts";

const builtins = new Map<string, AnyStepFactory | Preset>(
	[...Object.values(steps), ...Object.values(presets)].map((item) => [
		item.name,
		item,
	]),
);

export interface WorkflowOptions {
	/** Paths and packages are resolved from here. */
	cwd: string;
}

/**
 * Turns workflow `steps` (already parsed from YAML) into steps. Each entry is a
 * name, or a map of one name to its options:
 *
 * ```yaml
 * - conventional:              # a bundled preset or step
 *     github-release: false
 * - ./release/announce.ts:     # a file's default export
 *     channel: "#releases"
 * - some-package#slackNotes    # a package's named export
 * ```
 */
export async function resolveWorkflowSteps(
	entries: unknown,
	options: WorkflowOptions,
): Promise<Step[]> {
	if (!Array.isArray(entries)) {
		throw new OptionsError(["steps: expected a list of steps"]);
	}
	const parsed = entries.map((entry, index) => parseEntry(entry, index));
	const steps: Step[] = [];
	// Which preset each step came from, to catch steps configured twice.
	const fromPreset = new Map<string, string>();
	const explicit: { name: string; path: string }[] = [];

	for (const { name, value, at, path } of parsed) {
		const target = await load(name, path, options.cwd);
		try {
			if (isPreset(target)) {
				const created = target(value as never);
				for (const step of created) fromPreset.set(step.name, target.name);
				steps.push(...created);
			} else {
				steps.push(target(value));
				explicit.push({ name: target.name, path });
			}
		} catch (error) {
			if (!(error instanceof OptionsError)) throw error;
			throw new OptionsError(error.issues.map((issue) => `${at}.${issue}`));
		}
	}

	const twice = explicit.flatMap(({ name, path }) => {
		const preset = fromPreset.get(name);
		return preset
			? [
					`${path}: '${name}' is already in '${preset}'; configure it there (${preset}: { ${name}: ... }), or set it to false there to replace it`,
				]
			: [];
	});
	if (twice.length > 0) throw new OptionsError(twice);
	return steps;
}

function parseEntry(
	entry: unknown,
	index: number,
): { name: string; value: unknown; at: string; path: string } {
	const at = `steps[${index}]`;
	if (typeof entry === "string" && entry !== "") {
		return { name: entry, value: undefined, at, path: joinPath(at, [entry]) };
	}
	if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
		const keys = Object.keys(entry);
		const [name] = keys;
		if (keys.length === 1 && name) {
			const value = (entry as Record<string, unknown>)[name];
			return {
				name,
				value: value ?? undefined,
				at,
				path: joinPath(at, [name]),
			};
		}
	}
	throw new OptionsError([
		`${at}: expected a step name, or a map of one step name to its options`,
	]);
}

async function load(
	name: string,
	path: string,
	cwd: string,
): Promise<AnyStepFactory | Preset> {
	const builtin = builtins.get(name);
	if (builtin) return builtin;

	const [specifier = name, exportName = "default"] = name.split("#");
	const isPath = /^\.{0,2}\//.test(specifier);
	let url: string;
	try {
		url = isPath
			? pathToFileURL(resolve(cwd, specifier)).href
			: pathToFileURL(
					createRequire(join(cwd, "package.json")).resolve(specifier),
				).href;
	} catch {
		throw new OptionsError([
			`${path}: unknown step; use one of ${[...builtins.keys()].join(", ")}, a path like ./steps/x.ts, or an installed package`,
		]);
	}

	const module = (await import(url)) as Record<string, unknown>;
	const target = module[exportName];
	if (isFactory(target) || isPreset(target)) return target;
	throw new OptionsError([
		`${path}: export '${exportName}' of ${specifier} isn't a step made with defineStep or a preset made with definePreset`,
	]);
}

function isFactory(value: unknown): value is AnyStepFactory {
	if (typeof value !== "function") return false;
	const factory = value as Partial<AnyStepFactory>;
	return (
		(PHASES as readonly unknown[]).includes(factory.type) &&
		typeof factory.options === "object"
	);
}

function isPreset(value: unknown): value is Preset {
	return (
		typeof value === "function" &&
		Array.isArray((value as Partial<Preset>).steps)
	);
}
