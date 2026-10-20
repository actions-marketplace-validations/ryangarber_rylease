import { clock } from "../../utils/retry.ts";
import { GitHubError, githubClient, githubToken, isTransient } from "./api.ts";

beforeEach(() => {
	vi.spyOn(clock, "sleep").mockResolvedValue();
	vi.stubEnv("GITHUB_API_URL", "https://api.example.com");
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

/** Answers each request with the next response, recording it. */
function serve(...responses: Response[]) {
	const requests: { url: string; init: RequestInit }[] = [];
	vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
		requests.push({ url, init });
		const response = responses.shift();
		if (!response) throw new TypeError("fetch failed");
		return response;
	});
	return requests;
}

describe("githubToken", () => {
	it("takes the option, then GITHUB_TOKEN, then GH_TOKEN", () => {
		vi.stubEnv("GITHUB_TOKEN", "a");
		vi.stubEnv("GH_TOKEN", "b");
		expect(githubToken("option")).toBe("option");
		expect(githubToken(undefined)).toBe("a");
		vi.stubEnv("GITHUB_TOKEN", undefined);
		expect(githubToken(undefined)).toBe("b");
		vi.stubEnv("GH_TOKEN", undefined);
		expect(() => githubToken(undefined)).toThrow(
			"no token; set GITHUB_TOKEN or GH_TOKEN",
		);
	});
});

describe("isTransient", () => {
	it.each([
		[new GitHubError(429, ""), true],
		[new GitHubError(502, ""), true],
		[new GitHubError(404, ""), false],
		[new GitHubError(422, ""), false],
		[new TypeError("fetch failed"), true],
		[new Error("other"), false],
	])("%o → %s", (error, transient) => {
		expect(isTransient(error)).toBe(transient);
	});
});

describe("githubClient", () => {
	it("sends JSON to the repository's API, authenticated", async () => {
		const requests = serve(Response.json({ id: 1 }, { status: 201 }));
		const response = await githubClient("me/demo", "secret").request(
			"POST",
			"/releases",
			{ body: { tag_name: "v1" } },
		);
		expect(response).toEqual({ status: 201, data: { id: 1 } });
		expect(requests).toMatchObject([
			{
				url: "https://api.example.com/repos/me/demo/releases",
				init: {
					method: "POST",
					headers: {
						authorization: "Bearer secret",
						"content-type": "application/json",
					},
					body: '{"tag_name":"v1"}',
				},
			},
		]);
	});

	it("sends raw bodies to full URLs", async () => {
		const requests = serve(new Response(null, { status: 204 }));
		const content = new Uint8Array([1, 2]);
		const response = await githubClient("me/demo", "t").request(
			"POST",
			"https://uploads.example.com/x",
			{ body: content, contentType: "application/octet-stream" },
		);
		expect(response).toEqual({ status: 204, data: null });
		expect(requests[0]?.url).toBe("https://uploads.example.com/x");
		expect(requests[0]?.init.body).toBe(content);
		expect(requests[0]?.init.headers).toMatchObject({
			"content-type": "application/octet-stream",
		});
	});

	it("resolves with allowed statuses", async () => {
		serve(Response.json({ message: "Not Found" }, { status: 404 }));
		const response = await githubClient("me/demo", "t").request("GET", "/x", {
			allow: [404],
		});
		expect(response.status).toBe(404);
	});

	it("retries transient failures, waiting as asked when rate limited", async () => {
		const requests = serve(
			new Response("busy", { status: 502 }),
			new Response("slow down", {
				status: 429,
				headers: { "retry-after": "120" },
			}),
			Response.json({ ok: true }),
		);
		const response = await githubClient("me/demo", "t").request("GET", "/x");
		expect(response.data).toEqual({ ok: true });
		expect(requests).toHaveLength(3);
		// At most a minute, on top of the usual backoff of 1s, then 2s.
		expect(vi.mocked(clock.sleep).mock.calls).toEqual([
			[1000],
			[60_000],
			[2000],
		]);
	});

	it("fails at once on other errors, and after the last attempt", async () => {
		serve(new Response("nope", { status: 403 }));
		const forbidden = githubClient("me/demo", "t").request("GET", "/x");
		await expect(forbidden).rejects.toThrow(
			"GitHub responded 403 to GET https://api.example.com/repos/me/demo/x: nope",
		);
		await expect(forbidden).rejects.toBeInstanceOf(GitHubError);

		serve(new Response("", { status: 500 }), new Response("", { status: 500 }));
		await expect(
			githubClient("me/demo", "t").request("GET", "/x", { attempts: 2 }),
		).rejects.toMatchObject({ status: 500 });
	});
});
