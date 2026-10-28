/**
 * Generates the reference of the bundled steps, schemes, histories and
 * component sources in docs/reference/ from their definitions: a page each,
 * e.g. docs/reference/npm/publish.md, and an index. Run with
 * `pnpm build:docs`; `--check` fails if any page is stale.
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import * as components from "../src/components/index.ts";
import type { AnyStepFactory, Preset } from "../src/core/define.ts";
import { type AnyFactory, isFactory } from "../src/core/factory.ts";
import { z } from "../src/core/options.ts";
import { PHASES } from "../src/core/types.ts";
import * as histories from "../src/histories/index.ts";
import * as presets from "../src/presets/index.ts";
import * as schemes from "../src/schemes/index.ts";
import * as steps from "../src/steps/index.ts";

interface Schema {
	type?: string;
	const?: unknown;
	enum?: unknown[];
	anyOf?: Schema[];
	items?: Schema;
	properties?: Record<string, Schema>;
	required?: string[];
	additionalProperties?: Schema | boolean;
	default?: unknown;
	description?: string;
}

const ROOT = fileURLToPath(new URL("../docs/reference/", import.meta.url));
const INDEX = "README.md";

function typeOf(schema: Schema): string {
	if (schema.anyOf) return schema.anyOf.map(typeOf).join(" \\| ");
	if (schema.const !== undefined) return flow(schema.const);
	if (schema.enum) return schema.enum.map(flow).join(" \\| ");
	if (schema.type === "array" && schema.items) {
		return `${typeOf(schema.items)}[]`;
	}
	if (schema.type === "object" && schema.properties) {
		const fields = Object.entries(schema.properties).map(
			([key, value]) =>
				`${key}${schema.required?.includes(key) ? "" : "?"}: ${typeOf(value)}`,
		);
		return `{ ${fields.join(", ")} }`;
	}
	if (
		schema.type === "object" &&
		typeof schema.additionalProperties === "object"
	) {
		return `{ [key]: ${typeOf(schema.additionalProperties)} }`;
	}
	return schema.type ?? "unknown";
}

/** YAML flow style, as the value would be written in a workflow. */
function flow(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(flow).join(", ")}]`;
	if (typeof value === "object" && value !== null) {
		const entries = Object.entries(value).map(([k, v]) => `${k}: ${flow(v)}`);
		return entries.length > 0 ? `{ ${entries.join(", ")} }` : "{}";
	}
	return String(value);
}

/** Where a factory's page is, relative to docs/reference/. */
function pathOf(factory: AnyFactory): string {
	return `${factory.name}.md`;
}

/** A link from one page of docs/reference/ to another. */
function link(from: string, to: string): string {
	return relative(dirname(join(ROOT, from)), join(ROOT, to));
}

const KINDS: Record<string, string> = {
	scheme: "Scheme: set it as the release's `scheme`.",
	history: "History: set it as the release's `history`.",
	components: "Components: set it as the release's `components`.",
};

function page(factory: AnyFactory): string {
	const path = pathOf(factory);
	const schema = z.toJSONSchema(z.object(factory.options), {
		io: "input",
	}) as Schema;
	const options = Object.entries(schema.properties ?? {});
	const lines = [
		`# \`${factory.name}\``,
		"",
		isStep(factory)
			? `Step, in ${phase(factory)}.`
			: (KINDS[factory.kind] ?? ""),
		"",
		[factory.description ?? "", ...(isStep(factory) ? contract(factory) : [])]
			.join(" ")
			.trim(),
		"",
		"## Options",
		"",
	];
	if (options.length === 0) {
		lines.push("No options.");
	} else {
		lines.push("| Option | Type | Default | |", "|---|---|---|---|");
		for (const [name, option] of options) {
			const fallback =
				option.default !== undefined
					? `\`${flow(option.default)}\``
					: schema.required?.includes(name)
						? "required"
						: "";
			lines.push(
				`| \`${name}\` | \`${typeOf(option)}\` | ${fallback} | ${option.description ?? ""} |`,
			);
		}
	}
	if (isStep(factory)) {
		const including = presetList().filter((preset) =>
			preset.steps.some((step) => step.name === factory.name),
		);
		if (including.length > 0) {
			lines.push("", "## In presets", "");
			for (const preset of including) {
				const defaults = (
					preset.defaults as Record<string, object | undefined>
				)[factory.name];
				lines.push(
					`- \`${preset.name}\`${defaults ? `, with \`${flow(defaults)}\`` : ""}`,
				);
			}
		}
	}
	lines.push("", `[All steps, schemes and sources](${link(path, INDEX)})`);
	return `${lines.join("\n")}\n`;
}

function index(): string {
	const row = (factory: AnyFactory) =>
		`| [\`${factory.name}\`](${pathOf(factory)}) | ${(factory.description ?? "").replaceAll("\n", " ")} |`;
	const table = (heading: string, intro: string, list: AnyFactory[]) => [
		`## ${heading}`,
		"",
		intro,
		"",
		"| Name | |",
		"|---|---|",
		...list.map(row),
		"",
	];
	const stepList = factories(steps, "step") as AnyStepFactory[];
	const byPhase = (step: AnyStepFactory) =>
		typeof step.phase === "string"
			? PHASES.indexOf(step.phase)
			: Number.POSITIVE_INFINITY;
	const sorted = [...stepList].sort((a, b) => byPhase(a) - byPhase(b));
	return [
		"# Reference",
		"",
		"Generated from the definitions by `pnpm build:docs`. For how they fit together, see the [README](../../README.md).",
		"",
		...table(
			"Steps",
			"Listed in `steps`, in any order; they run by phase.",
			sorted,
		),
		...table("Schemes", "Set as the release's `scheme`.", factories(schemes)),
		...table(
			"Histories",
			"Set as the release's `history`: where the previous release is found.",
			factories(histories),
		),
		...table(
			"Components",
			"Set as the release's `components`: what's versioned, in a monorepo.",
			factories(components),
		),
	]
		.join("\n")
		.trimEnd()
		.concat("\n");
}

function isStep(factory: AnyFactory): factory is AnyStepFactory {
	return factory.kind === "step";
}

function factories(module: object, kind?: AnyFactory["kind"]): AnyFactory[] {
	return (Object.values(module) as unknown[]).filter((item) =>
		isFactory(item, kind),
	);
}

function presetList(): Preset[] {
	return factories(presets, "preset") as unknown as Preset[];
}

/** A step's phase, or the phases its `phase` option allows when its options pick it. */
function phase(step: AnyStepFactory): string {
	if (typeof step.phase === "string") return `the \`${step.phase}\` phase`;
	const option = step.options.phase;
	if (!(option instanceof z.ZodEnum)) {
		throw new Error(
			`${step.name}: its phase is a function without a phase option`,
		);
	}
	const names = option.options.map((name) => `\`${name}\``);
	return `the ${names.slice(0, -1).join(", ")} or ${names.at(-1)} phase, as its \`phase\` option picks`;
}

/** How a step runs, and its facts, e.g. `Runs once for all components.` */
function contract(step: AnyStepFactory): string[] {
	const list = (facts: readonly string[]) =>
		facts.map((fact) => `\`${fact}\``).join(", ");
	return [
		...(step.scope === "all" ? ["Runs once for all components."] : []),
		...(step.needs.length > 0 ? [`Needs ${list(step.needs)}.`] : []),
		...(step.provides.length > 0 ? [`Provides ${list(step.provides)}.`] : []),
	];
}

async function existing(directory: string): Promise<string[]> {
	const entries = await readdir(directory, {
		recursive: true,
		withFileTypes: true,
	}).catch(() => []);
	return entries
		.filter((entry) => entry.isFile())
		.map((entry) => relative(directory, join(entry.parentPath, entry.name)));
}

const pages = new Map<string, string>([[INDEX, index()]]);
for (const factory of [
	...factories(steps, "step"),
	...factories(schemes),
	...factories(histories),
	...factories(components),
]) {
	const path = pathOf(factory);
	if (pages.has(path)) throw new Error(`two pages for ${factory.name}`);
	pages.set(path, page(factory));
}

if (process.argv.includes("--check")) {
	const stale: string[] = [];
	for (const [path, content] of pages) {
		const current = await readFile(join(ROOT, path), "utf8").catch(() => null);
		if (current !== content) stale.push(path);
	}
	for (const path of await existing(ROOT)) {
		if (!pages.has(path)) stale.push(path);
	}
	if (stale.length > 0) {
		console.error(
			`docs/reference is out of date (${stale.join(", ")}); run \`pnpm build:docs\``,
		);
		process.exitCode = 1;
	}
} else {
	await rm(ROOT, { recursive: true, force: true });
	for (const [path, content] of pages) {
		await mkdir(dirname(join(ROOT, path)), { recursive: true });
		await writeFile(join(ROOT, path), content);
	}
}
