import { defineStep } from "../../core/define.ts";
import { z } from "../../core/options.ts";
import { git } from "../../utils/git.ts";
import { retry } from "../../utils/retry.ts";
import { fill } from "../../utils/template.ts";

interface Release {
	tag_name: string;
	_links: { self: string };
}

class GitLabError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = "GitLabError";
		this.status = status;
	}
}

/**
 * Creates a GitLab release for the version, with the notes as its
 * description, or finds the one another job already created. In GitLab CI,
 * the project, API and job token come from the job's environment.
 */
export const gitlabCreateRelease = defineStep({
	phase: "release",
	name: "gitlab/create-release",
	description:
		"Creates a GitLab release of the tag with the notes, unless it already has one; the tag is created at HEAD if it doesn't exist.",
	options: {
		title: z
			.string()
			.default("{tag}")
			.describe(
				"`{tag}`, `{version}`, `{name}` and the scheme's placeholders are filled in.",
			),
		project: z
			.string()
			.optional()
			.describe(
				"The project's ID or path, e.g. `group/project`; defaults to `CI_PROJECT_ID`.",
			),
		token: z
			.string()
			.optional()
			.describe("Defaults to `GITLAB_TOKEN`, then the job's `CI_JOB_TOKEN`."),
	},
	run: async ({ env, tag, placeholders, notes, options }) => {
		const title = fill(options.title, placeholders);
		const project = options.project ?? process.env.CI_PROJECT_ID;
		if (!project) {
			throw new Error(
				"couldn't determine the GitLab project; set `project` or CI_PROJECT_ID",
			);
		}
		if (env.dryRun) {
			return {
				output: { project, tag, url: null },
				reason: `would create release ${tag} on ${project}`,
			};
		}
		const request = gitlabClient(project, options.token);
		let created = true;
		let release: Release;
		try {
			release = await request<Release>("POST", "/releases", {
				tag_name: tag,
				ref: await git(env.cwd, "rev-parse", "HEAD"),
				name: title,
				description: notes,
			});
		} catch (error) {
			// 409: the tag already has a release, e.g. from another job.
			if (!(error instanceof GitLabError && error.status === 409)) throw error;
			created = false;
			release = await request<Release>(
				"GET",
				`/releases/${encodeURIComponent(tag)}`,
			);
		}
		const url = release._links.self;
		return {
			output: { project, tag, url },
			reason: `${created ? "created" : "found existing"} release ${tag}: ${url}`,
		};
	},
});

/** Requests to a project's REST API, retrying rate limits and server errors. */
function gitlabClient(project: string, token: string | undefined) {
	const api = process.env.CI_API_V4_URL || "https://gitlab.com/api/v4";
	const auth = token ?? process.env.GITLAB_TOKEN;
	const header = auth
		? { "private-token": auth }
		: process.env.CI_JOB_TOKEN
			? { "job-token": process.env.CI_JOB_TOKEN }
			: undefined;
	if (!header)
		throw new Error("no token; set GITLAB_TOKEN, or run in GitLab CI");
	return <T>(method: string, path: string, body?: unknown): Promise<T> =>
		retry(
			async () => {
				const url = `${api}/projects/${encodeURIComponent(project)}${path}`;
				const response = await fetch(url, {
					method,
					headers: {
						...header,
						...(body !== undefined && { "content-type": "application/json" }),
					},
					...(body !== undefined && { body: JSON.stringify(body) }),
				});
				const text = await response.text();
				if (!response.ok) {
					throw new GitLabError(
						response.status,
						`GitLab responded ${response.status} to ${method} ${url}: ${text}`,
					);
				}
				return JSON.parse(text) as T;
			},
			{
				attempts: 5,
				retryIf: (error) =>
					error instanceof GitLabError
						? error.status === 429 || error.status >= 500
						: error instanceof TypeError,
			},
		);
}
