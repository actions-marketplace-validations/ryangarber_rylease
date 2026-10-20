import { useRepo } from "../../testing/repo.ts";
import { runStep } from "../../testing/step.ts";
import { git } from "../../utils/git.ts";
import { githubReadPullRequests } from "./read-pull-requests.ts";

const repo = useRepo();

const pull = (number: number, extra: Record<string, unknown> = {}) => ({
	number,
	title: `PR ${number}`,
	body: null,
	html_url: `https://github.com/me/demo/pull/${number}`,
	merged_at: "2026-10-01T00:00:00Z",
	base: { ref: "main" },
	labels: [],
	...extra,
});

describe("github/read-pull-requests", () => {
	it("collects the merged pull requests of the commits since the ref", async () => {
		const ref = await git(repo.cwd, "rev-parse", "HEAD~3");
		const [head, middle, first] = (
			await git(repo.cwd, "log", "--format=%H", `${ref}..HEAD`)
		).split("\n");
		vi.stubEnv("GITHUB_API_URL", "https://api.github.com");
		const urls: string[] = [];
		vi.stubGlobal("fetch", async (url: string) => {
			urls.push(url);
			const sha = /commits\/(\w+)\/pulls/.exec(url)?.[1];
			const pulls = {
				[head ?? ""]: [
					pull(3, {
						body: " Squashed.\n",
						labels: [{ name: "breaking" }, { name: "enhancement" }],
					}),
				],
				// Pushed directly: no pull request.
				[middle ?? ""]: [],
				[first ?? ""]: [
					pull(1, { labels: [{ name: "bug" }] }),
					pull(2, { merged_at: null }),
					pull(4, { base: { ref: "feature" } }),
				],
			}[sha ?? ""];
			return Response.json(pulls ?? []);
		});

		const output = await runStep(
			githubReadPullRequests({ repo: "me/demo", token: "t" }),
			{ previousVersion: "1.0.0", previousRef: ref },
			{ cwd: repo.cwd },
		);
		expect(output).toEqual({
			changes: [
				{
					title: "PR 3",
					description: "Squashed.",
					reason: "PR #3",
					link: { label: "#3", url: "https://github.com/me/demo/pull/3" },
					labels: ["breaking", "enhancement"],
				},
				{
					title: "PR 1",
					reason: "PR #1",
					link: { label: "#1", url: "https://github.com/me/demo/pull/1" },
					labels: ["bug"],
				},
			],
			reason: `2 pull requests in 3 commits since ${ref.slice(0, 7)}`,
		});
		expect(urls).toHaveLength(3);
		expect(urls[0]).toBe(
			`https://api.github.com/repos/me/demo/commits/${head}/pulls`,
		);
	});

	it("needs a token", async () => {
		vi.stubEnv("GITHUB_TOKEN", "");
		vi.stubEnv("GH_TOKEN", "");
		await expect(
			runStep(
				githubReadPullRequests({ repo: "me/demo" }),
				{ previousVersion: "1.0.0" },
				{ cwd: repo.cwd },
			),
		).rejects.toThrow("no token");
	});
});
