import type { ReleaseReport } from "../core/engine.ts";

/**
 * A report as flat outputs, the same for the GitHub Action and the CLI:
 * `status`, `released`, `previous-version`, `version`, `kind`, `notes`,
 * `channel`, `prerelease`, and every component's as JSON in `components`.
 */
export function reportOutputs(report: ReleaseReport): Record<string, string> {
	return {
		status: report.status,
		released: String(report.status === "released"),
		"previous-version": report.previousVersion ?? "",
		version: report.version ?? "",
		kind: report.kind ?? "",
		notes: report.notes ?? "",
		channel: report.env.channel?.name ?? "",
		prerelease: String(report.env.channel?.type === "prerelease"),
		components: JSON.stringify(
			Object.fromEntries(
				report.components.map((component) => [
					component.name,
					{
						path: component.path,
						status: component.status,
						released: component.status === "released",
						"previous-version": component.previousVersion ?? "",
						version: component.version ?? "",
						tag: component.tag ?? "",
						kind: component.kind ?? "",
						notes: component.notes ?? "",
					},
				]),
			),
		),
		"released-components": JSON.stringify(
			report.components
				.filter((component) => component.status === "released")
				.map((component) => component.name),
		),
	};
}
