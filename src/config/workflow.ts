import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as components from "../components/index.ts";
import type { Channel } from "../core/channels.ts";
import type { Component, ComponentSource } from "../core/components.ts";
import type { AnyStepFactory, Preset, ReleaseConfig } from "../core/define.ts";
import { when } from "../core/define.ts";
import {
	compileExpression,
	ExpressionError,
	expressionContext,
} from "../core/expression.ts";
import {
	type AnyFactory,
	type FactoryKind,
	isFactory,
} from "../core/factory.ts";
import type { History } from "../core/history.ts";
import { joinPath, OptionsError, z } from "../core/options.ts";
import type { Scheme } from "../core/scheme.ts";
import type { Step } from "../core/types.ts";
import * as histories from "../histories/index.ts";
import * as presets from "../presets/index.ts";
import * as schemes from "../schemes/index.ts";
import * as steps from "../steps/index.ts";

type Loadable = AnyStepFactory | Preset | AnyFactory;

const builtins = new Map<string, Loadable>(
	(
		[
			...Object.values(steps),
			...Object.values(presets),
			...Object.values(schemes),
			...Object.values(histories),
			...Object.values(components),
		] as unknown[]
	)
		.filter((item): item is Loadable => isFactory(item))
		.map((item) => [item.name, item]),
);

/** What a workflow gives, already parsed from YAML. */
export interface WorkflowInput {
	steps: unknown;
	scheme?: unknown;
	tag?: unknown;
	history?: unknown;
	components?: unknown;
	channels?: unknown;
}

const CHANNELS = z.record(
	z.string(),
	z.strictObject({
		branches: z.array(z.string()).optional(),
		type: z.enum(["prerelease", "build"]).optional(),
		format: z.string().optional(),
	}),
);

/** A release defined in a workflow, ready for `defineRelease`. */
export type WorkflowRelease = Omit<ReleaseConfig<undefined>, "context">;

/**
 * Turns a workflow's inputs into a release: its `steps`, and how versions are
 * made (`scheme`), tagged (`tag`), found (`history`), and of what
 * (`components`). Each of those but `tag` names what it `uses` and passes
 * it options `with`, or is just a name:
 *
 * ```yaml
 * scheme: { uses: calver, with: { format: YY.MINOR.MICRO } }
 * components: npm/workspaces
 * ```
 */
export async function resolveWorkflow(
	input: WorkflowInput,
	options: WorkflowOptions,
): Promise<WorkflowRelease> {
	const scheme =
		input.scheme == null
			? undefined
			: await create<Scheme>(input.scheme, "scheme", "scheme", options.cwd);
	const history =
		input.history == null
			? undefined
			: await Promise.all(
					(Array.isArray(input.history) ? input.history : [input.history]).map(
						(entry, index) =>
							create<History>(
								entry,
								"history",
								Array.isArray(input.history) ? `history[${index}]` : "history",
								options.cwd,
							),
					),
				);
	if (input.tag != null && typeof input.tag !== "string") {
		throw new OptionsError(["tag: expected a template, e.g. v{version}"]);
	}
	return {
		steps: await resolveWorkflowSteps(input.steps, options),
		...(scheme && { scheme }),
		...(typeof input.tag === "string" &&
			input.tag !== "" && { tag: input.tag }),
		...(history && { history }),
		...(input.components != null && {
			components: await resolveComponentsInput(input.components, options.cwd),
		}),
		...(input.channels != null && { channels: parseChannels(input.channels) }),
	};
}

function parseChannels(value: unknown): Record<string, Channel> {
	const result = CHANNELS.safeParse(value);
	if (result.success) return result.data as Record<string, Channel>;
	throw new OptionsError(
		result.error.issues.map(
			(issue) => `${joinPath("channels", issue.path)}: ${issue.message}`,
		),
	);
}

async function resolveComponentsInput(
	value: unknown,
	cwd: string,
): Promise<Component[] | ComponentSource> {
	if (!Array.isArray(value)) {
		return create<ComponentSource>(value, "components", "components", cwd);
	}
	const keys = ["name", "path", "dependsOn", "tag", "scheme", "history"];
	const components: Component[] = [];
	for (const [index, entry] of value.entries()) {
		const at = `components[${index}]`;
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
			throw new OptionsError([`${at}: expected a map with 'name' and 'path'`]);
		}
		const fields = entry as Record<string, unknown>;
		const unknown = Object.keys(fields).filter((key) => !keys.includes(key));
		if (unknown.length > 0) {
			throw new OptionsError(
				unknown.map(
					(key) => `${at}.${key}: unknown key; use ${keys.join(", ")}`,
				),
			);
		}
		const text = (key: string) => {
			const field = fields[key];
			if (field != null && typeof field !== "string") {
				throw new OptionsError([`${at}.${key}: expected text`]);
			}
			return field ?? undefined;
		};
		const dependsOn = fields.dependsOn;
		if (
			dependsOn != null &&
			!(
				Array.isArray(dependsOn) &&
				dependsOn.every((item) => typeof item === "string")
			)
		) {
			throw new OptionsError([
				`${at}.dependsOn: expected a list of component names`,
			]);
		}
		const name = text("name");
		const path = text("path");
		const tag = text("tag");
		components.push({
			name: name ?? "",
			...(path !== undefined && { path }),
			...(tag !== undefined && { tag }),
			...(dependsOn != null && { dependsOn: dependsOn as string[] }),
			...(fields.scheme != null && {
				scheme: await create<Scheme>(
					fields.scheme,
					"scheme",
					`${at}.scheme`,
					cwd,
				),
			}),
			...(fields.history != null && {
				history: await create<History>(
					fields.history,
					"history",
					`${at}.history`,
					cwd,
				),
			}),
		});
	}
	return components;
}

/** Creates a scheme, history or component source from `name` or `{ uses, with }`. */
async function create<R>(
	value: unknown,
	kind: FactoryKind,
	at: string,
	cwd: string,
): Promise<R> {
	const entry =
		typeof value === "string" ? { uses: value, with: undefined } : value;
	if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
		throw new OptionsError([
			`${at}: expected a name, or a map with 'uses' and 'with'`,
		]);
	}
	const fields = entry as Record<string, unknown>;
	const unknown = Object.keys(fields).filter(
		(key) => key !== "uses" && key !== "with",
	);
	if (unknown.length > 0) {
		throw new OptionsError(
			unknown.map((key) => `${at}.${key}: unknown key; use uses, with`),
		);
	}
	if (typeof fields.uses !== "string" || fields.uses === "") {
		throw new OptionsError([
			`${at}.uses: expected the name of a ${kind === "components" ? "component source" : kind}`,
		]);
	}
	const target = await load(fields.uses, `${at}.uses`, cwd);
	if (target.kind !== kind) {
		throw new OptionsError([
			`${at}.uses: '${fields.uses}' is a ${target.kind}, not a ${kind === "components" ? "component source" : kind}`,
		]);
	}
	try {
		return (target as AnyFactory<FactoryKind, R>)(fields.with ?? undefined);
	} catch (error) {
		if (!(error instanceof OptionsError)) throw error;
		throw new OptionsError(
			error.issues.map(
				(issue) =>
					`${at}.with${issue.startsWith(target.name) ? issue.slice(target.name.length) : `: ${issue}`}`,
			),
		);
	}
}

export interface WorkflowOptions {
	/** Paths and packages are resolved from here. */
	cwd: string;
}

/**
 * Turns workflow `steps` (already parsed from YAML) into steps. Each entry
 * names what it `uses`, passes it options `with`, and may run only `if` an
 * expression holds:
 *
 * ```yaml
 * - uses: conventional              # a bundled preset or step
 *   with:
 *     github/create-release: false
 * - uses: ./release/announce.ts     # a file's default export
 *   if: "!dryRun && kind != 'patch'"
 *   with:
 *     channel: "#releases"
 * - uses: some-package#slackNotes   # a package's named export
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
	const explicit: { name: string; at: string }[] = [];

	for (const { uses, with: value, condition, at } of parsed) {
		const target = await load(uses, `${at}.uses`, options.cwd);
		if (target.kind !== "step" && target.kind !== "preset") {
			throw new OptionsError([
				`${at}.uses: '${uses}' is a ${target.kind}, not a step; set it as \`${target.kind}\` instead`,
			]);
		}
		let created: Step[];
		try {
			if (isPreset(target)) {
				created = target(value as never);
				for (const step of created) fromPreset.set(step.name, target.name);
			} else {
				created = [(target as AnyStepFactory)(value)];
				explicit.push({ name: target.name, at });
			}
		} catch (error) {
			if (!(error instanceof OptionsError)) throw error;
			// Issues start with the step's or preset's name; point at `with`.
			throw new OptionsError(
				error.issues.map(
					(issue) =>
						`${at}.with${issue.startsWith(target.name) ? issue.slice(target.name.length) : `: ${issue}`}`,
				),
			);
		}
		steps.push(
			...created.map((step) =>
				condition ? (when(step as Step<never>, condition) as Step) : step,
			),
		);
	}

	const twice = explicit.flatMap(({ name, at }) => {
		const preset = fromPreset.get(name);
		return preset
			? [
					`${at}.uses: '${name}' is already in '${preset}'; configure it there (with: { ${name}: ... }), or set it to false there to replace it`,
				]
			: [];
	});
	if (twice.length > 0) throw new OptionsError(twice);
	return steps;
}

const ENTRY_KEYS = ["uses", "with", "if"];

function parseEntry(
	entry: unknown,
	index: number,
): { uses: string; with: unknown; condition?: Condition; at: string } {
	const at = `steps[${index}]`;
	if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
		throw new OptionsError([
			`${at}: expected a map with 'uses', and optionally 'with' and 'if'`,
		]);
	}
	const fields = entry as Record<string, unknown>;
	const unknown = Object.keys(fields).filter(
		(key) => !ENTRY_KEYS.includes(key),
	);
	if (unknown.length > 0) {
		throw new OptionsError(
			unknown.map(
				(key) => `${at}.${key}: unknown key; use ${ENTRY_KEYS.join(", ")}`,
			),
		);
	}
	if (typeof fields.uses !== "string" || fields.uses === "") {
		throw new OptionsError([
			`${at}.uses: expected the name of a step or preset`,
		]);
	}
	if (
		fields.with != null &&
		(typeof fields.with !== "object" || Array.isArray(fields.with))
	) {
		throw new OptionsError([`${at}.with: expected a map of options`]);
	}
	const condition = parseCondition(fields.if, `${at}.if`);
	return {
		uses: fields.uses,
		with: fields.with ?? undefined,
		...(condition && { condition }),
		at,
	};
}

type Condition = { (input: unknown): boolean; source: string };

/**
 * `if:` is a rylease expression, or a boolean, e.g. what GitHub made of
 * `${{ ... }}` before rylease ran.
 */
function parseCondition(value: unknown, at: string): Condition | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value === "boolean") {
		return Object.assign(() => value, { source: String(value) });
	}
	if (typeof value !== "string") {
		throw new OptionsError([`${at}: expected an expression or a boolean`]);
	}
	try {
		const evaluate = compileExpression(value);
		return Object.assign(
			(input: unknown) => Boolean(evaluate(expressionContext(input))),
			{ source: value },
		);
	} catch (error) {
		if (!(error instanceof ExpressionError)) throw error;
		throw new OptionsError([`${at}: ${error.message} in \`${value}\``]);
	}
}

async function load(
	name: string,
	path: string,
	cwd: string,
): Promise<Loadable> {
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
			`${path}: unknown step ${name}; use one of ${[...builtins.keys()].join(", ")}, a path like ./steps/x.ts, or an installed package`,
		]);
	}

	const module = (await import(url)) as Record<string, unknown>;
	const target = module[exportName];
	if (isFactory(target)) return target as Loadable;
	throw new OptionsError([
		`${path}: export '${exportName}' of ${specifier} isn't made with defineStep, definePreset, defineScheme, defineHistory or defineComponents`,
	]);
}

function isPreset(value: Loadable): value is Preset {
	return value.kind === "preset";
}
