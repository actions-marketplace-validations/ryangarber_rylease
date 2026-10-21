import type { ComponentReport, ReleaseReport } from "./engine.ts";
import { formatDuration } from "./reporter.ts";

const ICONS = { ok: "✅", skipped: "⚪", failed: "❌" } as const;

/**
 * The report as Markdown, for GitHub's job summary: what happened, a row per
 * step, and the release notes.
 */
export function markdownSummary(report: ReleaseReport): string {
	const dryRun = report.env.dryRun;
	const several = report.components.length > 1;
	const describe = (component: ComponentReport) => {
		const from = component.previousVersion ?? "nothing";
		const to = component.version ?? "?";
		if (component.status !== "released" && component.status !== "pending") {
			return `**${from}** · nothing to release`;
		}
		const versions =
			from === to ? `**${to}**` : `**${from}** → **${to}** (${component.kind})`;
		const action =
			component.status === "pending"
				? dryRun
					? "would be proposed"
					: "proposed"
				: dryRun
					? "would release"
					: "released";
		return `${versions} · ${action}`;
	};
	const [only] = report.components;
	const headline =
		report.status === "failed"
			? "release failed"
			: !several && only
				? describe(only)
				: report.status === "released"
					? dryRun
						? "would release"
						: "released"
					: report.status === "pending"
						? dryRun
							? "would be proposed"
							: "proposed"
						: "nothing to release";
	const lines = [
		`### ${report.status === "failed" ? "❌ " : ""}rylease${dryRun ? " dry run" : ""} · ${headline}`,
		"",
		`On \`${report.env.branch}\`${report.env.channel ? `, on the \`${report.env.channel.name}\` channel` : ""}${dryRun ? ", without side effects" : ""}.${report.deferred ? ` ${report.deferred[0]?.toUpperCase()}${report.deferred.slice(1)}.` : ""}`,
		...(several && report.status !== "failed"
			? [
					"",
					...report.components.map(
						(component) => `- \`${component.name}\`: ${describe(component)}`,
					),
				]
			: []),
		"",
		several
			? "| | Component | Type | Step | Time | |"
			: "| | Type | Step | Time | |",
		several ? "|:-:|---|---|---|--:|---|" : "|:-:|---|---|--:|---|",
		...report.records.map(
			(record) =>
				`| ${ICONS[record.status]} |${several ? ` ${record.component ? `\`${record.component}\`` : "all"} |` : ""} \`${record.phase}\` | \`${record.name}\` | ${
					record.status === "skipped" ? "" : formatDuration(record.durationMs)
				} | ${cell(record.reason)} |`,
		),
	];
	for (const component of report.components) {
		if (report.status === "failed" || report.status === "unchanged") continue;
		if (component.status !== "released" && component.status !== "pending")
			continue;
		if (!component.notes?.trim()) continue;
		lines.push(
			"",
			`<details open><summary>Release notes${several ? ` of ${component.name} ${component.version}` : ""}</summary>`,
			"",
			component.notes.trim(),
			"",
			"</details>",
		);
	}
	return `${lines.join("\n")}\n\n`;
}

/** Problems with the input itself, before any step ran. */
export function markdownProblems(issues: readonly string[]): string {
	return [
		"### ❌ rylease · invalid input",
		"",
		...issues.map((issue) => `- ${cell(issue)}`),
		"",
		"",
	].join("\n");
}

/** Text that stays inside one table cell or list item. */
function cell(text: string): string {
	return text
		.replaceAll("|", "\\|")
		.replaceAll("<", "&lt;")
		.replace(/\r?\n/g, "<br>");
}
