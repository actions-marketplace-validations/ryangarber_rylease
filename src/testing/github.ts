import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { defineRelease } from "../core/define.ts";
import type { StepDefinition } from "../core/types.ts";
import { gitTags } from "../histories/index.ts";
import { semver } from "../schemes/semver.ts";
import { git } from "../utils/git.ts";
import { clock } from "../utils/retry.ts";

interface Asset {
	id: number;
	name: string;
	state: string;
	size: number;
	content: string;
}

interface Release {
	id: number;
	tag_name: string;
	name: string;
	target_commitish: string;
	draft: boolean;
	prerelease: boolean;
	body: string;
	assets: Asset[];
}

export interface Pull {
	number: number;
	title: string;
	body: string;
	state: "open" | "closed";
	head: { ref: string };
	base: { ref: string };
	labels: { name: string }[];
	merged_at: string | null;
	merge_commit_sha: string | null;
	html_url: string;
}

/** Just enough of GitHub's API, and of the artifact service, to release to. */
export const github = {
	releases: [] as Release[],
	pulls: [] as Pull[],
	/** `METHOD /path` of every request, in order. */
	requests: [] as string[],
	/** Fail this many upload attempts with a 502, leaving a `starter` asset. */
	failUploads: 0,
	/** Answer the next create with a 422, as if another job had just won. */
	raceCreate: false,
	artifacts: new Map<string, { content?: Buffer; hash?: string }>(),
};

export interface FakeGitHub {
	/** The server's URL, as `GITHUB_API_URL`. */
	base: string;
	/** A git repository with one commit, and `dist/app linux`, `dist/app.exe` and `dist/nested/latest.json`. */
	cwd: string;
}

let nextId = 1;

function json(response: ServerResponse, status: number, body: unknown) {
	response.writeHead(status, { "content-type": "application/json" });
	response.end(JSON.stringify(body));
}

/**
 * Serves {@link github} for each test, as `me/demo` with a token, outside
 * GitHub Actions; see {@link useArtifactService} to be inside.
 */
export function useFakeGitHub(): FakeGitHub {
	const fake: FakeGitHub = { base: "", cwd: "" };
	let server: Server;

	const view = (release: Release) => ({
		id: release.id,
		tag_name: release.tag_name,
		draft: release.draft,
		html_url: `https://github.com/me/demo/releases/tag/${release.tag_name}`,
		upload_url: `${fake.base}/uploads/${release.id}/assets{?name,label}`,
	});

	beforeAll(async () => {
		server = createServer((request, response) => {
			const chunks: Buffer[] = [];
			request.on("data", (chunk: Buffer) => chunks.push(chunk));
			request.on("end", () => {
				const body = Buffer.concat(chunks);
				const url = new URL(request.url ?? "/", fake.base);
				const route = `${request.method} ${url.pathname}`;
				github.requests.push(route);

				const byTag = /^GET \/repos\/me\/demo\/releases\/tags\/(.+)$/.exec(
					route,
				);
				if (byTag) {
					const release = github.releases.find(
						(r) =>
							r.tag_name === decodeURIComponent(byTag[1] ?? "") && !r.draft,
					);
					return release
						? json(response, 200, view(release))
						: json(response, 404, {});
				}
				if (route === "GET /repos/me/demo/pulls") {
					const head = url.searchParams.get("head")?.replace(/^me:/, "");
					const state = url.searchParams.get("state") ?? "open";
					return json(
						response,
						200,
						github.pulls.filter(
							(pull) =>
								(head === undefined || pull.head.ref === head) &&
								(state === "all" || pull.state === state),
						),
					);
				}
				if (route === "POST /repos/me/demo/pulls") {
					const input = JSON.parse(body.toString()) as Record<string, string>;
					const number = nextId++;
					const pull: Pull = {
						number,
						title: input.title ?? "",
						body: input.body ?? "",
						state: "open",
						head: { ref: input.head ?? "" },
						base: { ref: input.base ?? "" },
						labels: [],
						merged_at: null,
						merge_commit_sha: null,
						html_url: `https://github.com/me/demo/pull/${number}`,
					};
					github.pulls.push(pull);
					return json(response, 201, pull);
				}
				const pull =
					/^(PATCH|POST) \/repos\/me\/demo\/(pulls|issues)\/(\d+)(\/labels)?$/.exec(
						route,
					);
				if (pull) {
					const found = github.pulls.find((p) => p.number === Number(pull[3]));
					if (!found) return json(response, 404, {});
					const input = JSON.parse(body.toString()) as {
						title?: string;
						body?: string;
						labels?: string[];
					};
					if (pull[4]) {
						for (const name of input.labels ?? []) {
							if (!found.labels.some((label) => label.name === name)) {
								found.labels.push({ name });
							}
						}
						return json(response, 200, found.labels);
					}
					Object.assign(found, {
						...(input.title !== undefined && { title: input.title }),
						...(input.body !== undefined && { body: input.body }),
					});
					return json(response, 200, found);
				}
				const merged =
					/^GET \/repos\/me\/demo\/commits\/([0-9a-f]+)\/pulls$/.exec(route);
				if (merged) {
					return json(
						response,
						200,
						github.pulls.filter((p) => p.merge_commit_sha === merged[1]),
					);
				}
				if (route === "GET /repos/me/demo/releases") {
					return json(response, 200, github.releases.map(view));
				}
				if (route === "POST /repos/me/demo/releases") {
					const input = JSON.parse(body.toString()) as Record<string, unknown>;
					const release: Release = {
						id: nextId++,
						tag_name: String(input.tag_name),
						name: String(input.name),
						target_commitish: String(input.target_commitish),
						draft: Boolean(input.draft),
						prerelease: Boolean(input.prerelease),
						body: String(input.body),
						assets: [],
					};
					github.releases.push(release);
					if (github.raceCreate) {
						github.raceCreate = false;
						return json(response, 422, { message: "already_exists" });
					}
					return json(response, 201, view(release));
				}
				const assets = /^GET \/repos\/me\/demo\/releases\/(\d+)\/assets$/.exec(
					route,
				);
				if (assets) {
					const release = github.releases.find(
						(r) => r.id === Number(assets[1]),
					);
					return json(
						response,
						200,
						(release?.assets ?? []).map(({ content: _, ...asset }) => asset),
					);
				}
				const remove =
					/^DELETE \/repos\/me\/demo\/releases\/assets\/(\d+)$/.exec(route);
				if (remove) {
					for (const release of github.releases) {
						release.assets = release.assets.filter(
							(a) => a.id !== Number(remove[1]),
						);
					}
					response.writeHead(204).end();
					return;
				}
				const upload = /^POST \/uploads\/(\d+)\/assets$/.exec(route);
				if (upload) {
					const release = github.releases.find(
						(r) => r.id === Number(upload[1]),
					);
					const name = (url.searchParams.get("name") ?? "").replaceAll(
						" ",
						".",
					);
					if (!release) return json(response, 404, {});
					if (release.assets.some((a) => a.name === name)) {
						return json(response, 422, { message: "already_exists" });
					}
					const asset: Asset = {
						id: nextId++,
						name,
						state: "uploaded",
						size: body.length,
						content: body.toString(),
					};
					release.assets.push(asset);
					if (github.failUploads > 0) {
						github.failUploads--;
						asset.state = "starter";
						return json(response, 502, {});
					}
					const { content: _, ...view } = asset;
					return json(response, 201, {
						...view,
						browser_download_url: `https://github.com/download/${name}`,
					});
				}

				// The artifact service, and the storage it signs uploads for.
				const twirp = "/twirp/github.actions.results.api.v1.ArtifactService/";
				if (route === `POST ${twirp}CreateArtifact`) {
					const input = JSON.parse(body.toString()) as { name: string };
					github.artifacts.set(input.name, {});
					return json(response, 200, {
						ok: true,
						signed_upload_url: `${fake.base}/blob/${encodeURIComponent(input.name)}?sig=1`,
					});
				}
				const blob = /^PUT \/blob\/(.+)$/.exec(route);
				if (blob) {
					const artifact = github.artifacts.get(
						decodeURIComponent(blob[1] ?? ""),
					);
					if (!artifact || request.headers["x-ms-blob-type"] !== "BlockBlob") {
						return json(response, 400, {});
					}
					artifact.content = body;
					response.writeHead(201).end();
					return;
				}
				if (route === `POST ${twirp}FinalizeArtifact`) {
					const input = JSON.parse(body.toString()) as {
						name: string;
						hash: string;
					};
					const artifact = github.artifacts.get(input.name);
					if (!artifact) return json(response, 404, {});
					artifact.hash = input.hash;
					return json(response, 200, { ok: true, artifact_id: "42" });
				}
				json(response, 404, { route });
			});
		});
		// `once` rejects on listen errors instead of leaving setup to time out.
		const listening = once(server, "listening");
		server.listen(0);
		await listening;
		fake.base = `http://localhost:${(server.address() as AddressInfo).port}`;
	});

	afterAll(() => {
		server.close();
	});

	beforeEach(async () => {
		github.releases = [];
		github.pulls = [];
		github.requests = [];
		github.failUploads = 0;
		github.raceCreate = false;
		github.artifacts.clear();
		vi.spyOn(clock, "sleep").mockResolvedValue();
		vi.stubEnv("GITHUB_API_URL", fake.base);
		vi.stubEnv("GITHUB_REPOSITORY", "me/demo");
		vi.stubEnv("GITHUB_TOKEN", "token");
		vi.stubEnv("ACTIONS_RESULTS_URL", "");
		vi.stubEnv("ACTIONS_RUNTIME_TOKEN", "");
		fake.cwd = await mkdtemp(join(tmpdir(), "rylease-github-"));
		await git(fake.cwd, "init", "-q");
		await git(
			fake.cwd,
			"-c",
			"user.name=t",
			"-c",
			"user.email=t@e",
			"commit",
			"-q",
			"--allow-empty",
			"-m",
			"init",
		);
		await mkdir(join(fake.cwd, "dist", "nested"), { recursive: true });
		await writeFile(join(fake.cwd, "dist", "app linux"), "linux");
		await writeFile(join(fake.cwd, "dist", "app.exe"), "windows");
		await writeFile(join(fake.cwd, "dist", "nested", "latest.json"), "{}");
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		await rm(fake.cwd, { recursive: true, force: true });
	});

	return fake;
}

/** Makes this a GitHub Actions job that can upload artifacts to {@link github}. */
export function useArtifactService(fake: FakeGitHub) {
	const claims = { scp: "Actions.GenericRead:1 Actions.Results:run-1:job-1" };
	const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
	vi.stubEnv("ACTIONS_RESULTS_URL", `${fake.base}/`);
	vi.stubEnv("ACTIONS_RUNTIME_TOKEN", `header.${payload}.signature`);
}

/** Runs steps for an already worked-out 1.2.0 release, as a later job would. */
export function releaseGiven(
	fake: FakeGitHub,
	steps: StepDefinition<"release">[],
	dryRun = false,
	tag?: string,
) {
	return defineRelease({
		steps,
		scheme: semver(),
		history: gitTags(),
		...(tag && { tag }),
	}).run({
		cwd: fake.cwd,
		dryRun,
		reporter: null,
		release: { version: "1.2.0", notes: "Notes." },
	});
}

/** `name=content` of each asset of a tag's releases. */
export function assetsOf(tag: string): string[] {
	return github.releases
		.filter((r) => r.tag_name === tag)
		.flatMap((r) => r.assets.map((a) => `${a.name}=${a.content}`));
}
