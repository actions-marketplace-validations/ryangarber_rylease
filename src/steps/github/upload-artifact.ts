import { defineStep } from "../../core/define.ts";
import { z } from "../../core/options.ts";
import { formatSize, inComponent, resolveFiles } from "../../utils/files.ts";
import { fill } from "../../utils/template.ts";
import { plural } from "../../utils/text.ts";
import { canUploadArtifacts, uploadFiles } from "./artifact.ts";

/**
 * Keeps files as an artifact of the workflow run; with `dryRunArtifact`, in
 * dry runs too, e.g. to keep what a dry run built.
 */
export const githubUploadArtifact = defineStep({
	phase: "release",
	name: "github/upload-artifact",
	description:
		"Uploads files as a workflow artifact. Only works in the GitHub Action.",
	options: {
		name: z
			.string()
			.describe(
				"The artifact's name, unique in the run; `{version}`, `{tag}` and the other placeholders are filled in.",
			),
		files: z
			.array(z.string())
			.min(1)
			.describe(
				"Paths, globs or directories, relative to the component's directory unless absolute; each must match.",
			),
		dryRunArtifact: z
			.boolean()
			.default(false)
			.describe("Upload in dry runs too."),
		retentionDays: z
			.number()
			.int()
			.min(1)
			.optional()
			.describe("Defaults to the repository's setting."),
	},
	run: async ({ env, component, placeholders, options }) => {
		const name = fill(options.name, placeholders);
		const files = await resolveFiles(
			inComponent(env, component, ".").file,
			options.files,
		);
		const listed = `${plural(files.length, "file")} as artifact ${name}`;
		if (env.dryRun && !(options.dryRunArtifact && canUploadArtifacts())) {
			return {
				output: { name, id: null, files: [] },
				reason: `would upload ${listed}${options.dryRunArtifact ? " (outside GitHub Actions)" : ""}`,
			};
		}
		const uploaded = await uploadFiles(name, files, options.retentionDays);
		return {
			output: { name, id: uploaded.id, files: uploaded.files },
			reason: `uploaded ${plural(files.length, "file")} (${formatSize(uploaded.size)}) as artifact ${name}`,
		};
	},
});
