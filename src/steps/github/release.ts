import { z } from "../../core/options.ts";
import { detectRepo } from "../../utils/git.ts";
import { retry, waitFor } from "../../utils/retry.ts";
import { type GitHubClient, GitHubError, isTransient } from "./api.ts";

/** The `repo` option, or the repository being released. */
export async function releaseRepo(
	cwd: string,
	repo: string | undefined,
): Promise<string> {
	const found = repo ?? (await detectRepo(cwd));
	if (!found) {
		throw new Error(
			"couldn't determine the GitHub repository; set `repo` or GITHUB_REPOSITORY",
		);
	}
	return found;
}

/** Options of the steps that create a release, or find one. */
export const releaseOptions = {
	title: z
		.string()
		.default("{tag}")
		.describe(
			"`{tag}`, `{version}`, `{name}` and the scheme's placeholders are filled in.",
		),
	draft: z.boolean().default(false),
	prerelease: z
		.union([z.boolean(), z.literal("auto")])
		.default("auto")
		.describe("`auto` marks releases on a prerelease channel."),
	repo: z
		.string()
		.optional()
		.describe(
			"`owner/repo`; defaults to `GITHUB_REPOSITORY` or the `origin` remote.",
		),
	token: z
		.string()
		.optional()
		.describe("Defaults to `GITHUB_TOKEN` or `GH_TOKEN`."),
};

export interface ReleaseAsset {
	id: number;
	name: string;
	/** `uploaded`, or `starter` when an upload never finished. */
	state: string;
	size: number;
	browser_download_url: string;
}

export interface Release {
	id: number;
	tag_name: string;
	html_url: string;
	upload_url: string;
	draft: boolean;
}

/** The release of a tag, drafts included, or `undefined`. */
async function findRelease(
	client: GitHubClient,
	tag: string,
): Promise<Release | undefined> {
	const { status, data } = await client.request<Release>(
		"GET",
		`/releases/tags/${encodeURIComponent(tag)}`,
		{ allow: [404] },
	);
	if (status !== 404) return data;
	// Drafts have no tag yet, so only a listing finds them.
	const { data: releases } = await client.request<Release[]>(
		"GET",
		"/releases?per_page=100",
	);
	return releases.find((release) => release.tag_name === tag);
}

export interface NewRelease {
	tag: string;
	target: string;
	title: string;
	notes: string;
	draft: boolean;
	prerelease: boolean;
}

/**
 * Finds the release of a tag, or creates it. Other jobs may be doing the same
 * at once: when one of them wins, this waits until its release is visible and
 * uses that.
 */
export async function ensureRelease(
	client: GitHubClient,
	release: NewRelease,
): Promise<{ release: Release; created: boolean }> {
	const existing = await findRelease(client, release.tag);
	if (existing) return { release: existing, created: false };
	try {
		const { data } = await client.request<Release>("POST", "/releases", {
			body: {
				tag_name: release.tag,
				target_commitish: release.target,
				name: release.title,
				body: release.notes,
				draft: release.draft,
				prerelease: release.prerelease,
			},
		});
		return { release: data, created: true };
	} catch (error) {
		// 422: the tag already has a release, created since we looked.
		if (!(error instanceof GitHubError && error.status === 422)) throw error;
		const created = await waitFor(() => findRelease(client, release.tag), {
			attempts: 5,
		});
		if (!created) throw error;
		return { release: created, created: false };
	}
}

/** The name GitHub stores an asset under, e.g. `My App.zip` → `My.App.zip`. */
export function assetName(file: string): string {
	return file.replace(/[^\w.+@~-]/g, ".");
}

async function listAssets(
	client: GitHubClient,
	release: Release,
): Promise<ReleaseAsset[]> {
	const assets: ReleaseAsset[] = [];
	for (let page = 1; ; page++) {
		const { data } = await client.request<ReleaseAsset[]>(
			"GET",
			`/releases/${release.id}/assets?per_page=100&page=${page}`,
		);
		assets.push(...data);
		if (data.length < 100) return assets;
	}
}

/**
 * Uploads a file as an asset of the release, retrying failed uploads. An
 * asset of the same name is replaced if `clobber` is set, or if it's what's
 * left of an unfinished upload.
 */
export async function uploadAsset(
	client: GitHubClient,
	release: Release,
	asset: { name: string; content: Uint8Array },
	clobber: boolean,
): Promise<ReleaseAsset> {
	const name = assetName(asset.name);
	return retry(
		async () => {
			const existing = (await listAssets(client, release)).find(
				(other) => other.name === name,
			);
			if (existing) {
				if (existing.state === "uploaded" && !clobber) {
					throw new Error(
						`release ${release.tag_name} already has ${name}; set clobber to replace it`,
					);
				}
				await client.request("DELETE", `/releases/assets/${existing.id}`, {
					allow: [404],
				});
			}
			const url = new URL(release.upload_url.replace(/\{.*\}$/, ""));
			url.searchParams.set("name", asset.name);
			const { data } = await client.request<ReleaseAsset>("POST", url.href, {
				body: asset.content,
				contentType: "application/octet-stream",
				// Retried as a whole, after clearing what a failed upload left.
				attempts: 1,
			});
			return data;
		},
		{ attempts: 5, retryIf: isTransient },
	);
}

/** Whether a release is a prerelease, by the `prerelease` option. */
export function isPrerelease(
	option: boolean | "auto",
	env: { channel?: { type: string } },
): boolean {
	return option === "auto" ? env.channel?.type === "prerelease" : option;
}
