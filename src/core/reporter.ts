import type { ComponentReport, ReleaseReport } from "./engine.ts";
import type {
	ComponentInfo,
	EnginePhase,
	Environment,
	Phase,
	StepRecord,
} from "./types.ts";

/** Receives progress from the engine; every hook is optional. */
export interface Reporter {
	start?(
		env: Environment,
		/** Every step, and the engine's own rows: `read-version` and `determine-version`. */
		steps: readonly { phase: Phase | EnginePhase; name: string }[],
		components: readonly ComponentInfo[],
	): void;
	step?(record: StepRecord): void;
	finish?(report: ReleaseReport): void;
}

export interface PrettyReporterOptions {
	/** Defaults to writing to stdout. */
	write?: (text: string) => void;
	/** Defaults to `true` on a TTY unless `NO_COLOR` is set. */
	color?: boolean;
}

const ANSI = {
	bold: [1, 22],
	dim: [2, 22],
	red: [31, 39],
	green: [32, 39],
	yellow: [33, 39],
	magenta: [35, 39],
	cyan: [36, 39],
} as const;

type Style = keyof typeof ANSI;

/** Aligned, colored output: one row per step with phase, name, duration and reason. */
export function prettyReporter(options: PrettyReporterOptions = {}): Reporter {
	const write =
		options.write ?? ((text: string) => void process.stdout.write(text));
	const color =
		options.color ??
		(process.env.FORCE_COLOR !== undefined ||
			(process.stdout.isTTY === true && process.env.NO_COLOR === undefined));
	const paint = (style: Style, text: string) =>
		color ? `\x1b[${ANSI[style][0]}m${text}\x1b[${ANSI[style][1]}m` : text;

	let phaseWidth = 0;
	let nameWidth = 0;
	let componentWidth = 0;
	let dryRun = false;

	return {
		start(env, steps, components) {
			dryRun = env.dryRun;
			phaseWidth = Math.max(0, ...steps.map((step) => step.phase.length));
			nameWidth = Math.max(0, ...steps.map((step) => step.name.length));
			componentWidth =
				components.length > 1
					? Math.max(...components.map((component) => component.name.length))
					: 0;
			const mode = env.dryRun ? paint("yellow", "dry run") : "release";
			write(
				`\n${paint("bold", "rylease")} ${mode} ${paint("dim", "·")} ${paint("cyan", env.branch)} ${paint("dim", `· ${env.cwd}`)}\n\n`,
			);
		},
		step(record) {
			const icon = {
				ok: paint("green", "✔"),
				skipped: paint("dim", "○"),
				failed: paint("red", "✖"),
			}[record.status];
			const phase = paint("magenta", record.phase.padEnd(phaseWidth));
			const name = paint("bold", record.name.padEnd(nameWidth));
			const component =
				componentWidth > 0
					? `${paint("cyan", (record.component ?? "*").padEnd(componentWidth))}  `
					: "";
			const duration = paint(
				"dim",
				(record.status === "skipped"
					? "-"
					: formatDuration(record.durationMs)
				).padStart(7),
			);
			const reason =
				record.status === "ok"
					? record.reason
					: paint(record.status === "failed" ? "red" : "dim", record.reason);
			write(
				`  ${icon} ${component}${phase}  ${name}  ${duration}  ${reason}\n`,
			);
		},
		finish(report) {
			const line = (component: ComponentReport) => {
				const from = component.previousVersion ?? "nothing";
				const action =
					component.status === "pending"
						? paint("yellow", dryRun ? "would be proposed" : "proposed")
						: dryRun
							? paint("yellow", "would release")
							: "released";
				if (component.status !== "released" && component.status !== "pending") {
					return `${paint("bold", from)} ${paint("dim", "·")} nothing to release`;
				}
				const to = paint("green", paint("bold", component.version ?? "?"));
				// A given release may not say what it was released from.
				return from === component.version
					? `${to} ${paint("dim", "·")} ${action}`
					: `${paint("bold", from)} → ${to} ${paint("dim", `(${component.kind})`)} ${paint("dim", "·")} ${action}`;
			};
			let summary: string;
			if (report.status === "failed") {
				summary = paint("red", "release failed");
			} else if (report.components.length === 1 && report.components[0]) {
				summary = line(report.components[0]);
			} else {
				const width = Math.max(
					...report.components.map((component) => component.name.length),
				);
				summary = report.components
					.map(
						(component) =>
							`${paint("cyan", component.name.padEnd(width))}  ${line(component)}`,
					)
					.join("\n  ");
			}
			const deferred =
				report.deferred === undefined
					? ""
					: `\n  ${paint("dim", report.deferred)}`;
			write(`\n  ${summary}${deferred}\n\n`);
		},
	};
}

export function defaultReporter(): Reporter {
	return prettyReporter();
}

export function formatDuration(ms: number): string {
	if (ms < 1) return "<1ms";
	if (ms < 1000) return `${Math.round(ms)}ms`;
	return `${(ms / 1000).toFixed(2)}s`;
}
