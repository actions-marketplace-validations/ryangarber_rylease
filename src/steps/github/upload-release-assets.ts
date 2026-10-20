import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { defineStep } from "../../core/define.ts";
import { z } from "../../core/options.ts";
import { formatSize, inComponent, resolveFiles } from "../../utils/files.ts";
import { git } from "../../utils/git.ts";
import { fill } from "../../utils/template.ts";
import { joinList } from "../../utils/text.ts";
import { githubClient, githubToken } from "./api.ts";
import { canUploadArtifacts, uploadFiles } from "./artifact.ts";
import {
	assetName,
	ensureRelease,
	isPrerelease,
	releaseOptions,
	releaseRepo,
	uploadAsset,
} from "./release.ts";

/**
 * Uploads files to the version's GitHub release, creating the release if no
 * other step or job has yet, so that jobs building different files can each
 * upload their own.
 */
export const githubUploadReleaseAssets = defineStep({
	type: "release",
	name: "github/upload-release-assets",
	description:
		"Uploads files to the GitHub release, creating it (with the notes) if no other job has yet.",
	options: {
		files: z
			.array(z.string())
			.min(1)
			.describe(
				"Paths or globs, relative to the component's directory unless absolute; each must match.",
			),
		clobber: z
			.boolean()
			.default(true)
			.describe("Replace assets of the same name."),
		dryRunArtifact: z
			.boolean()
			.default(false)
			.describe(
				"In dry runs, keep the files as a workflow artifact instead; only in the GitHub Action.",
			),
		artifactName: z
			.string()
			.optional()
			.describe(
				"Unique in the run; `{version}`, `{tag}` and the other placeholders are filled in. Defaults to the asset's name, or for several, a name made from theirs.",
			),
		...releaseOptions,
	},
	run: async ({ env, component, tag, placeholders, notes, options }) => {
		const title = fill(options.title, placeholders);
		const repo = await releaseRepo(env.cwd, options.repo);
		const files = await resolveFiles(
			inComponent(env, component, ".").file,
			options.files,
		);
		const sizes = await Promise.all(
			files.map(async (file) => (await stat(file)).size),
		);
		const listed = files.map(
			(file, index) =>
				`${assetName(basename(file))} (${formatSize(sizes[index] ?? 0)})`,
		);
		if (env.dryRun) {
			const reason = `would upload ${joinList(listed)} to release ${tag} on ${repo}`;
			if (!options.dryRunArtifact) {
				return { output: { repo, tag, url: null, assets: [] }, reason };
			}
			const artifact = artifactNameOf(
				files,
				options.artifactName,
				placeholders,
			);
			if (!canUploadArtifacts()) {
				return {
					output: { repo, tag, url: null, assets: [], artifact: null },
					reason: `${reason} (no artifact ${artifact} outside GitHub Actions)`,
				};
			}
			const { id } = await uploadFiles(artifact, files);
			return {
				output: {
					repo,
					tag,
					url: null,
					assets: [],
					artifact: { name: artifact, id },
				},
				reason: `${reason}; kept them as artifact ${artifact}`,
			};
		}

		const client = githubClient(repo, githubToken(options.token));
		const { release, created } = await ensureRelease(client, {
			tag,
			target: await git(env.cwd, "rev-parse", "HEAD"),
			title,
			notes,
			draft: options.draft,
			prerelease: isPrerelease(options.prerelease, env),
		});
		const assets = [];
		for (const file of files) {
			const asset = await uploadAsset(
				client,
				release,
				{ name: basename(file), content: await readFile(file) },
				options.clobber,
			);
			assets.push({
				name: asset.name,
				size: asset.size,
				url: asset.browser_download_url,
			});
		}
		return {
			output: { repo, tag, url: release.html_url, assets },
			reason: `uploaded ${joinList(listed)} to ${created ? "new" : "existing"} release ${tag}: ${release.html_url}`,
		};
	},
});

function artifactNameOf(
	files: readonly string[],
	name: string | undefined,
	placeholders: Readonly<Record<string, string>>,
): string {
	if (name !== undefined) return fill(name, placeholders);
	const assets = files.map((file) => assetName(basename(file)));
	if (assets.length === 1 && assets[0]) return assets[0];
	const hash = createHash("sha256").update(assets.join("\n")).digest("hex");
	return `release-assets-${hash.slice(0, 8)}`;
}
