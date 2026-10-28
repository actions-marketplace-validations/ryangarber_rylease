import { stringify } from "yaml";
import { setPath } from "./mocks.ts";
import type { Missing, SimulationResult, StepResult } from "./simulate.ts";

const SYMBOLS: Record<StepResult["status"], string> = {
	success: "✔",
	failure: "✖",
	skipped: "○",
};

/** A step as one line: what it was and what came of it. */
export function stepLine(step: StepResult): string {
	const symbol =
		step.kind === "assumed" && step.status === "success"
			? "·"
			: SYMBOLS[step.status];
	return `${symbol} ${step.label}${step.reason ? `  ${step.reason}` : ""}`;
}

/**
 * Workflow commands as plain text, e.g. `::error::x` as `error: x`, and
 * without color unless it's kept.
 */
export function cleanLine(line: string, color: boolean): string {
	const command = /^::(error|warning|notice|debug)(?: [^:]*)?::(.*)$/.exec(
		line,
	);
	const text = command
		? `${command[1]}: ${command[2]?.replaceAll("%0A", "\n").replaceAll("%0D", "\r").replaceAll("%25", "%")}`
		: line;
	if (/^::(group|endgroup|add-mask)/.test(text)) return "";
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are control characters.
	return color ? text : text.replace(/\x1b\[[0-9;]*m/g, "");
}

/** The summary after the jobs: outputs, what's not as in CI, and what wasn't mocked. */
export function summaryText(
	result: SimulationResult,
	mocksFile: string,
): string {
	const lines: string[] = [];
	const section = (title: string, entries: string[]) => {
		if (entries.length === 0) return;
		lines.push("", title, ...entries.map((entry) => `  ${entry}`));
	};

	section(
		"Outputs",
		result.jobs.flatMap((job) =>
			Object.keys(job.outputs).length === 0
				? []
				: [
						`${job.id}:`,
						...Object.entries(job.outputs).map(
							([name, value]) => `  ${name}: ${oneLine(value)}`,
						),
					],
		),
	);

	const real = result.jobs.flatMap((job) =>
		job.legs.flatMap((leg) =>
			leg.steps
				.filter((step) => step.kind === "simulated" && step.dryRun !== "true")
				.map((step) => step),
		),
	);
	section(
		"Dry run",
		real.map(
			(step) =>
				`${step.at}: in CI, this runs for real (dry-run: '${step.dryRun}'); here it was a dry run`,
		),
	);
	section("Warnings", result.warnings);
	section("Notes", result.notes);

	// Missing `github` values are often meant to be, e.g. another event's behind a `||`.
	const missing = dedupe(result.missing).filter(
		(entry) => !entry.path.startsWith("github."),
	);
	if (missing.length > 0) {
		section(
			"Read but not set (empty here)",
			missing.map((entry) => `${entry.path}  at ${entry.at}`),
		);
		const snippet = mocksSnippet(missing);
		if (snippet) {
			lines.push(
				"",
				`To mock them, add to ${mocksFile}, or pass --env, --var, --secret, --input, --set or --output:`,
				"",
			);
			lines.push(
				...snippet
					.trimEnd()
					.split("\n")
					.map((line) => `  ${line}`),
			);
		}
	}
	const failed = result.jobs.filter((job) => job.status === "failure");
	lines.push(
		"",
		failed.length > 0
			? `✖ ${failed.map((job) => job.id).join(", ")} failed`
			: `✔ ${result.jobs.filter((job) => job.status === "success").length} of ${result.jobs.length} jobs ran, as dry runs`,
	);
	return `${lines.join("\n")}\n`;
}

function oneLine(value: string): string {
	const first = value.split("\n")[0] ?? "";
	return value.includes("\n") ? `${first} …` : first;
}

function dedupe(missing: readonly Missing[]): Missing[] {
	const seen = new Map<string, Missing>();
	for (const entry of missing)
		if (!seen.has(entry.path)) seen.set(entry.path, entry);
	return [...seen.values()];
}

/**
 * Mocks for what was read but not there, of what's for mocking: outputs of
 * jobs, and env, vars, secrets and inputs.
 */
export function mocksSnippet(missing: readonly Missing[]): string {
	const mocks: Record<string, unknown> = {};
	for (const { path } of missing) {
		const [root = "", ...rest] = path.split(".");
		if (rest.some((part) => part.includes("[") || part === "*")) continue;
		if (root === "needs" && rest[1] === "outputs" && rest.length === 3) {
			setPath(mocks, `outputs.${rest[0]}.${rest[2]}`, "");
		} else if (
			["env", "vars", "secrets", "inputs"].includes(root) &&
			rest.length === 1
		) {
			setPath(mocks, `${root}.${rest[0]}`, "");
		}
	}
	return Object.keys(mocks).length === 0 ? "" : stringify(mocks);
}
