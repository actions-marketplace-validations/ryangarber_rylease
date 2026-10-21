#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { access, appendFile, mkdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { configuredRelease } from "./config/load.ts";
import { reportOutputs } from "./config/outputs.ts";
import { provideSelf } from "./config/self.ts";
import {
	errorMessage,
	ReleaseError,
	type ReleaseReport,
} from "./core/engine.ts";
import { OptionsError } from "./core/options.ts";
import { prettyReporter } from "./core/reporter.ts";
import { markdownSummary } from "./core/summary.ts";
import { KINDS, type Kind } from "./core/types.ts";
import { formatChangeFile, slug } from "./steps/change-files/parse.ts";

// Custom steps import "rylease", which resolves to this module (see provideSelf).
export * from "./index.ts";

const HELP = `Usage: rylease [release] [options]
       rylease add [options] <title>

Runs the release in rylease.config.ts, rylease.yml or .github/rylease.yml,
or the conventional preset without one.

Options:
  --dry-run              Run every step without side effects
  --channel <name>       Release on a channel, e.g. next
  --branch <name>        Defaults to the CI's branch, or the checked-out one
  --cwd <dir>            The project; defaults to the working directory
  --config <file>        The config; defaults to the first that exists
  --release <version>    Run only the release steps, for a version made before
  --notes <text>         Its notes, with --release
  --component <name>     Its component, with --release
  --json                 Print the report as JSON instead
  --outputs <file>       Write outputs as KEY=VALUE lines, e.g. a GitLab dotenv report
  --summary <file>       Append a Markdown summary

rylease add writes a change file, for the change-files preset:
  --component <name[:kind]>  A component it changes; repeat for several
  --kind <kind>              breaking, feature, fix (default) or none
  --description <text>       More about the change
  --directory <dir>          Where change files are kept; defaults to .changes
`;

interface Io {
	cwd: string;
	write: (text: string) => void;
	error: (text: string) => void;
}

/** Runs the CLI; resolves with its exit code. */
export async function cli(
	argv: readonly string[],
	io: Io = {
		cwd: process.cwd(),
		write: (text) => void process.stdout.write(text),
		error: (text) => void process.stderr.write(text),
	},
): Promise<number> {
	const [command, ...rest] =
		argv[0] === "add" || argv[0] === "release" || argv[0] === "help"
			? argv
			: ["release", ...argv];
	try {
		if (command === "help" || rest.includes("--help") || rest.includes("-h")) {
			io.write(HELP);
			return 0;
		}
		return command === "add" ? await add(rest, io) : await release(rest, io);
	} catch (error) {
		const issues =
			error instanceof OptionsError ? error.issues : [errorMessage(error)];
		// A failed release has been reported already, step by step.
		for (const issue of issues) io.error(`rylease: ${issue}\n`);
		return 1;
	}
}

async function release(argv: readonly string[], io: Io): Promise<number> {
	const { values } = parsing(() =>
		parseArgs({
			args: [...argv],
			strict: true,
			options: {
				"dry-run": { type: "boolean" },
				channel: { type: "string" },
				branch: { type: "string" },
				cwd: { type: "string" },
				config: { type: "string" },
				release: { type: "string" },
				notes: { type: "string" },
				component: { type: "string" },
				json: { type: "boolean" },
				outputs: { type: "string" },
				summary: { type: "string" },
			},
		}),
	);
	const cwd = resolve(io.cwd, values.cwd ?? ".");
	const definition = await configuredRelease(cwd, values.config, {});
	let report: ReleaseReport;
	try {
		report = await definition.run({
			cwd,
			dryRun: values["dry-run"] ?? false,
			reporter: values.json ? null : prettyReporter({ write: io.write }),
			...(values.branch && { branch: values.branch }),
			...(values.channel && { channel: values.channel }),
			...(values.release && {
				release: {
					version: values.release,
					...(values.notes !== undefined && { notes: values.notes }),
					...(values.component && { component: values.component }),
				},
			}),
		});
	} catch (error) {
		if (!(error instanceof ReleaseError)) throw error;
		report = error.report;
	}
	if (values.json) io.write(`${JSON.stringify(report, jsonValue, 2)}\n`);
	if (values.summary) {
		await appendFile(resolve(io.cwd, values.summary), markdownSummary(report));
	}
	if (values.outputs && report.status !== "failed") {
		await writeFile(
			resolve(io.cwd, values.outputs),
			dotenv(reportOutputs(report)),
		);
	}
	if (report.status === "failed") {
		io.error(`rylease: ${errorMessage(report.error)}\n`);
		return 1;
	}
	return 0;
}

async function add(argv: readonly string[], io: Io): Promise<number> {
	const { values, positionals } = parsing(() =>
		parseArgs({
			args: [...argv],
			strict: true,
			allowPositionals: true,
			options: {
				component: { type: "string", multiple: true },
				kind: { type: "string" },
				description: { type: "string" },
				directory: { type: "string" },
				cwd: { type: "string" },
			},
		}),
	);
	const title = positionals.join(" ").trim();
	if (title === "")
		throw new OptionsError([
			'add: say what changed, e.g. rylease add "Add dark mode"',
		]);
	const kind = kindOf(values.kind ?? "fix", "--kind");
	const kinds: Record<string, Kind> = {};
	for (const entry of values.component ?? []) {
		const [name = "", own] = entry.split(/:(?=[^:]*$)/);
		kinds[name] =
			own === undefined ? kind : kindOf(own, `--component ${entry}`);
	}
	if (Object.keys(kinds).length === 0) kinds.kind = kind;
	const cwd = resolve(io.cwd, values.cwd ?? ".");
	const directory = join(cwd, values.directory ?? ".changes");
	await mkdir(directory, { recursive: true });
	const base = slug(title);
	let path = join(directory, `${base}.md`);
	for (let n = 2; await exists(path); n++)
		path = join(directory, `${base}-${n}.md`);
	await writeFile(
		path,
		formatChangeFile({
			kinds,
			title,
			...(values.description && { description: values.description }),
		}),
		{ flag: "wx" },
	);
	io.write(`wrote ${relative(io.cwd, path)}\n`);
	return 0;
}

function kindOf(value: string, at: string): Kind {
	if (!(KINDS as readonly string[]).includes(value)) {
		throw new OptionsError([
			`${at}: '${value}' isn't a kind; use ${KINDS.join(", ")}`,
		]);
	}
	return value as Kind;
}

/** Arguments as parsed, or an error pointing at `--help`. */
function parsing<T>(parse: () => T): T {
	try {
		return parse();
	} catch (error) {
		throw new OptionsError([`${errorMessage(error)}; see rylease --help`]);
	}
}

function exists(path: string): Promise<boolean> {
	return access(path).then(
		() => true,
		() => false,
	);
}

/** Outputs as `RYLEASE_KEY=value` lines; newlines are written as `\n`. */
function dotenv(outputs: Record<string, string>): string {
	return Object.entries(outputs)
		.map(
			([key, value]) =>
				`RYLEASE_${key.toUpperCase().replaceAll("-", "_")}=${value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n")}\n`,
		)
		.join("");
}

/** Errors as their message, so a report is plain JSON. */
function jsonValue(_key: string, value: unknown): unknown {
	return value instanceof Error ? { message: value.message } : value;
}

if (process.argv[1] && isMain(process.argv[1])) {
	provideSelf(import.meta.url);
	// Not awaited: custom steps import this module, so it must finish evaluating.
	void cli(process.argv.slice(2)).then((code) => {
		process.exitCode = code;
	});
}

/** Whether this module was run directly, maybe through a bin link. */
function isMain(script: string): boolean {
	try {
		return import.meta.url === pathToFileURL(realpathSync(script)).href;
	} catch {
		return false;
	}
}
