import { appendFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { optional } from "@optique/core/modifiers";
import type { InferValue } from "@optique/core/parser";
import { command, constant, flag, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import {
	errorMessage,
	markdownSummary,
	prettyReporter,
	ReleaseError,
	type ReleaseReport,
} from "rylease";
import { configuredRelease, reportOutputs } from "rylease/internal";
import type { Io } from "../io.ts";

export const releaseCommand = command(
	"release",
	object({
		command: constant("release"),
		dryRun: optional(
			flag("--dry-run", {
				description: message`Run every step without side effects`,
			}),
		),
		channel: optional(
			option("--channel", string({ metavar: "NAME" }), {
				description: message`Release on a channel, e.g. next`,
			}),
		),
		branch: optional(
			option("--branch", string({ metavar: "NAME" }), {
				description: message`Defaults to the CI's branch, or the checked-out one`,
			}),
		),
		cwd: optional(
			option("--cwd", string({ metavar: "DIR" }), {
				description: message`The project; defaults to the working directory`,
			}),
		),
		config: optional(
			option("--config", string({ metavar: "FILE" }), {
				description: message`The config; defaults to the first that exists`,
			}),
		),
		release: optional(
			option("--release", string({ metavar: "VERSION" }), {
				description: message`Run only the release steps, for a version made before`,
			}),
		),
		notes: optional(
			option("--notes", string({ metavar: "TEXT" }), {
				description: message`Its notes, with --release`,
			}),
		),
		component: optional(
			option("--component", string({ metavar: "NAME" }), {
				description: message`Its component, with --release`,
			}),
		),
		json: optional(
			flag("--json", {
				description: message`Print the report as JSON instead`,
			}),
		),
		outputs: optional(
			option("--outputs", string({ metavar: "FILE" }), {
				description: message`Write outputs as KEY=VALUE lines, e.g. a GitLab dotenv report`,
			}),
		),
		summary: optional(
			option("--summary", string({ metavar: "FILE" }), {
				description: message`Append a Markdown summary`,
			}),
		),
	}),
	{
		brief: message`Run the release (the default command)`,
		description: message`Runs the release in rylease.config.ts, rylease.yml or .github/rylease.yml, or the conventional preset without one.`,
	},
);

export async function release(
	values: InferValue<typeof releaseCommand>,
	io: Io,
): Promise<number> {
	const cwd = resolve(io.cwd, values.cwd ?? ".");
	const definition = await configuredRelease(cwd, values.config, {});
	let report: ReleaseReport;
	try {
		report = await definition.run({
			cwd,
			dryRun: values.dryRun ?? false,
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
export function jsonValue(_key: string, value: unknown): unknown {
	return value instanceof Error ? { message: value.message } : value;
}
