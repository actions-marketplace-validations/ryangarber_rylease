import { useRepo } from "../../testing/repo.ts";
import { released, runStep } from "../../testing/step.ts";
import { git } from "../../utils/git.ts";
import { clock } from "../../utils/retry.ts";
import { gitlabCreateRelease } from "./create-release.ts";

const repo = useRepo();

interface Request {
	method: string;
	url: string;
	headers: Record<string, string>;
	body?: unknown;
}

let requests: Request[];

function serve(...responses: Response[]) {
	vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
		requests.push({
			method: String(init.method),
			url,
			headers: init.headers as Record<string, string>,
			...(init.body !== undefined && { body: JSON.parse(String(init.body)) }),
		});
		return responses.shift() ?? new Response("", { status: 500 });
	});
}

const release = (tag: string) =>
	Response.json(
		{
			tag_name: tag,
			_links: { self: `https://gitlab.example.com/g/p/-/releases/${tag}` },
		},
		{ status: 201 },
	);

beforeEach(() => {
	requests = [];
	vi.spyOn(clock, "sleep").mockResolvedValue();
	vi.stubEnv("CI_API_V4_URL", "https://gitlab.example.com/api/v4");
	vi.stubEnv("CI_PROJECT_ID", "42");
	vi.stubEnv("GITLAB_TOKEN", "");
	vi.stubEnv("CI_JOB_TOKEN", "job");
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("gitlab/create-release", () => {
	it("creates a release at HEAD with the notes, as the CI job", async () => {
		serve(release("v1.2.0"));
		const output = await runStep(
			gitlabCreateRelease({ title: "Demo {version}" }),
			released("1.2.0", { notes: "Notes." }),
			{ cwd: repo.cwd },
		);
		expect(output).toEqual({
			output: {
				project: "42",
				tag: "v1.2.0",
				url: "https://gitlab.example.com/g/p/-/releases/v1.2.0",
			},
			reason:
				"created release v1.2.0: https://gitlab.example.com/g/p/-/releases/v1.2.0",
		});
		expect(requests).toEqual([
			{
				method: "POST",
				url: "https://gitlab.example.com/api/v4/projects/42/releases",
				headers: { "job-token": "job", "content-type": "application/json" },
				body: {
					tag_name: "v1.2.0",
					ref: await git(repo.cwd, "rev-parse", "HEAD"),
					name: "Demo 1.2.0",
					description: "Notes.",
				},
			},
		]);
	});

	it("uses a release another job created, and retries server errors", async () => {
		serve(
			new Response("", { status: 502 }),
			new Response("{}", { status: 409 }),
			release("v1.2.0"),
		);
		const output = await runStep(
			gitlabCreateRelease({ project: "g/p", token: "secret" }),
			released("1.2.0"),
			{ cwd: repo.cwd },
		);
		expect(output.reason).toMatch(/^found existing release v1\.2\.0: /);
		expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
			"POST https://gitlab.example.com/api/v4/projects/g%2Fp/releases",
			"POST https://gitlab.example.com/api/v4/projects/g%2Fp/releases",
			"GET https://gitlab.example.com/api/v4/projects/g%2Fp/releases/v1.2.0",
		]);
		expect(requests[0]?.headers["private-token"]).toBe("secret");
	});

	it("only says what it would do in a dry run, and needs a project", async () => {
		serve();
		expect(
			(
				await runStep(gitlabCreateRelease(), released("1.2.0"), {
					cwd: repo.cwd,
					dryRun: true,
				})
			).reason,
		).toBe("would create release v1.2.0 on 42");
		expect(requests).toEqual([]);
		vi.stubEnv("CI_PROJECT_ID", "");
		await expect(
			runStep(gitlabCreateRelease(), released("1.2.0"), { cwd: repo.cwd }),
		).rejects.toThrow("couldn't determine the GitLab project");
	});
});
