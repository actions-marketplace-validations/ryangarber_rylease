import { randomUUID } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import {
	errorMessage,
	ReleaseError,
	type ReleaseReport,
} from "../core/engine.ts";
import { OptionsError } from "../core/options.ts";
import { prettyReporter, type Reporter } from "../core/reporter.ts";
import { markdownProblems, markdownSummary } from "../core/summary.ts";
import { configuredRelease } from "./load.ts";
import { reportOutputs } from "./outputs.ts";
import { provideSelf } from "./self.ts";

// Custom steps import "rylease", which resolves to this module (see provideSelf).
export * from "../index.ts";

/**
 * Runs the GitHub Action: reads its inputs from `INPUT_*`, runs the release
 * and writes its outputs to `GITHUB_OUTPUT`. Resolves with the exit code.
 */
export async function main(
	env: NodeJS.ProcessEnv = process.env,
	reporter: Reporter | null = prettyReporter({
		...(env.GITHUB_ACTIONS === "true" && { color: true }),
	}),
): Promise<number> {
	const input = (name: string) => env[`INPUT_${name.toUpperCase()}`] ?? "";
	let summary = true;
	let report: ReleaseReport;
	try {
		summary = parseBoolean("summary", input("summary") || "true");
		const cwd = resolve(
			env.GITHUB_WORKSPACE ?? process.cwd(),
			input("working-directory") || ".",
		);
		const token = input("token");
		if (token && !env.GITHUB_TOKEN && !env.GH_TOKEN) {
			process.env.GITHUB_TOKEN = token;
		}
		const optional = (name: string) => {
			const text = input(name);
			return text.trim() === "" ? undefined : parseYaml(name, text);
		};
		const release = await configuredRelease(cwd, input("config") || undefined, {
			steps: optional("steps"),
			scheme: optional("scheme"),
			tag: input("tag") || undefined,
			history: optional("history"),
			components: optional("components"),
			channels: optional("channels"),
		});
		const version = input("version");
		const component = input("component");
		const channel = input("channel");
		report = await release.run({
			cwd,
			dryRun: parseBoolean("dry-run", input("dry-run") || "false"),
			reporter,
			...(channel && { channel }),
			...(version && {
				release: {
					version,
					notes: input("notes"),
					...(component && { component }),
				},
			}),
		});
	} catch (error) {
		let issues: readonly string[];
		if (error instanceof ReleaseError) {
			// The reporter has printed the details.
			issues = [error.message];
			if (summary) await writeSummary(env, markdownSummary(error.report));
		} else {
			issues =
				error instanceof OptionsError ? error.issues : [errorMessage(error)];
			if (summary) await writeSummary(env, markdownProblems(issues));
		}
		for (const issue of issues) annotate(issue);
		return 1;
	}

	if (summary) await writeSummary(env, markdownSummary(report));
	await setOutputs(env.GITHUB_OUTPUT, reportOutputs(report));
	return 0;
}

/** Appends to the job summary, the Markdown GitHub shows on the run's page. */
async function writeSummary(env: NodeJS.ProcessEnv, markdown: string) {
	if (env.GITHUB_STEP_SUMMARY)
		await appendFile(env.GITHUB_STEP_SUMMARY, markdown);
}

function parseYaml(name: string, text: string): unknown {
	try {
		return parse(text);
	} catch (error) {
		throw new OptionsError([`${name}: invalid YAML: ${errorMessage(error)}`]);
	}
}

function parseBoolean(name: string, value: string): boolean {
	if (value === "true") return true;
	if (value === "false") return false;
	throw new OptionsError([`${name}: expected true or false, got '${value}'`]);
}

function annotate(message: string) {
	const escaped = message
		.replaceAll("%", "%25")
		.replaceAll("\r", "%0D")
		.replaceAll("\n", "%0A");
	process.stdout.write(`::error::${escaped}\n`);
}

async function setOutputs(
	file: string | undefined,
	outputs: Record<string, string>,
) {
	if (!file) return;
	const delimiter = `rylease_${randomUUID()}`;
	const text = Object.entries(outputs)
		.map(([name, value]) => `${name}<<${delimiter}\n${value}\n${delimiter}\n`)
		.join("");
	await appendFile(file, text);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	provideSelf(import.meta.url);
	// Not awaited: custom steps import this module, so it must finish evaluating.
	void main().then((code) => {
		process.exitCode = code;
	});
}
