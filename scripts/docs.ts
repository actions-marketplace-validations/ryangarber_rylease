/**
 * Generates the options reference of the bundled steps in README.md from their
 * definitions. Run with `pnpm build:docs`; `--check` fails if README.md is stale.
 */
import { readFile, writeFile } from "node:fs/promises";
import * as components from "../src/components/index.ts";
import type { AnyStepFactory } from "../src/core/define.ts";
import { type AnyFactory, isFactory } from "../src/core/factory.ts";
import { z } from "../src/core/options.ts";
import * as histories from "../src/histories/index.ts";
import { conventional } from "../src/presets/index.ts";
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

const README = new URL("../README.md", import.meta.url);
const START = "<!-- options:start -->";
const END = "<!-- options:end -->";

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

function reference(): string {
	const others = Object.values(steps).filter(
		(step) => !conventional.steps.some((other) => other.name === step.name),
	);
	const presetDefaults: Record<string, Record<string, unknown> | undefined> =
		conventional.defaults;
	const section = (step: AnyFactory) => {
		const schema = z.toJSONSchema(z.object(step.options), {
			io: "input",
		}) as Schema;
		const options = Object.entries(schema.properties ?? {});
		const heading = `#### \`${step.name}\` · ${isStep(step) ? phase(step) : `\`${step.kind}\``}\n\n${[step.description ?? "", ...(isStep(step) ? contract(step) : [])].join(" ")}`;
		if (options.length === 0) return `${heading}\n\nNo options.`;
		const preset = presetDefaults[step.name] ?? {};
		const rows = options.map(([name, option]) => {
			const own =
				option.default !== undefined
					? `\`${flow(option.default)}\``
					: schema.required?.includes(name)
						? "required"
						: "";
			const fallback =
				name in preset
					? `\`${flow(preset[name])}\` in \`conventional\`, ${own || "none"} on its own`
					: own;
			return `| \`${name}\` | \`${typeOf(option)}\` | ${fallback} | ${option.description ?? ""} |`;
		});
		return [
			heading,
			"",
			"| Option | Type | Default | |",
			"|---|---|---|---|",
			...rows,
		].join("\n");
	};
	const sections = [
		...conventional.steps.map(section),
		"### More steps\n\nThese aren't in `conventional`; list them with it, or in its place: see [Other sources and schemes](#other-sources-and-schemes). Steps run by phase, so they can be listed in any order; steps of the same phase run in the order given.",
		...others.map(section),
		"### Bundled schemes\n\nSet one as the release's `scheme`; see [Schemes](#schemes).",
		...factories(schemes).map(section),
		"### Bundled sources\n\nWhere previous releases are found, set as `history`, and what's released, set as `components`.",
		...factories(histories).map(section),
		"### Bundled components\n\nWhere components are found, set as `components`.",
		...factories(components).map(section),
	];
	return `${START}\n${sections.join("\n\n")}\n${END}`;
}

function isStep(factory: AnyFactory): factory is AnyStepFactory {
	return factory.kind === "step";
}

function factories(module: object): AnyFactory[] {
	return (Object.values(module) as unknown[]).filter((item) => isFactory(item));
}

/** A step's phase, or the phases its `phase` option allows when its options pick it. */
function phase(step: AnyStepFactory): string {
	if (typeof step.phase === "string") return `\`${step.phase}\``;
	const option = step.options.phase;
	if (!(option instanceof z.ZodEnum)) {
		throw new Error(
			`${step.name}: its phase is a function without a phase option`,
		);
	}
	return `\`${option.options.join(" | ")}\``;
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

const readme = await readFile(README, "utf8");
const start = readme.indexOf(START);
const end = readme.indexOf(END);
if (start === -1 || end === -1) throw new Error(`README.md has no ${START}`);
const updated =
	readme.slice(0, start) + reference() + readme.slice(end + END.length);

if (process.argv.includes("--check")) {
	if (updated !== readme) {
		console.error("README.md is out of date; run `pnpm build:docs`");
		process.exitCode = 1;
	}
} else {
	await writeFile(README, updated);
}
