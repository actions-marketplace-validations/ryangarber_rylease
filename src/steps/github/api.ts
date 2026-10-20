import { clock, retry } from "../../utils/retry.ts";

/** The token option, `GITHUB_TOKEN` or `GH_TOKEN`. */
export function githubToken(token: string | undefined): string {
	const found = token ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
	if (!found) throw new Error("no token; set GITHUB_TOKEN or GH_TOKEN");
	return found;
}

export class GitHubError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = "GitHubError";
		this.status = status;
	}
}

/** Statuses worth another try: rate limits and server errors. */
export function isTransient(error: unknown): boolean {
	if (error instanceof GitHubError) {
		return error.status === 429 || error.status >= 500;
	}
	// fetch rejects with a TypeError when the connection fails.
	return error instanceof TypeError;
}

interface RequestOptions {
	body?: unknown;
	/** Sends `body` as is, with this content type, instead of as JSON. */
	contentType?: string;
	/** Statuses that resolve instead of rejecting, e.g. `[404]`. */
	allow?: number[];
	/** Tries in all; defaults to 5. */
	attempts?: number;
}

export interface GitHubClient {
	readonly repo: string;
	/** `path` is relative to the repository's API URL, unless it's a full URL. */
	request<T>(
		method: string,
		path: string,
		options?: RequestOptions,
	): Promise<{ status: number; data: T }>;
}

/** A GitHub REST client for one repository that retries transient failures. */
export function githubClient(repo: string, token: string): GitHubClient {
	const apiUrl = process.env.GITHUB_API_URL ?? "https://api.github.com";
	return {
		repo,
		request: (method, path, options = {}) =>
			retry(
				async () => {
					const url = /^https?:/.test(path)
						? path
						: `${apiUrl}/repos/${repo}${path}`;
					const response = await fetch(url, {
						method,
						headers: {
							accept: "application/vnd.github+json",
							authorization: `Bearer ${token}`,
							"x-github-api-version": "2022-11-28",
							...(options.body !== undefined && {
								"content-type": options.contentType ?? "application/json",
							}),
						},
						...(options.body !== undefined && {
							body:
								options.contentType === undefined
									? JSON.stringify(options.body)
									: (options.body as Uint8Array<ArrayBuffer>),
						}),
					});
					const text = await response.text();
					if (!response.ok && !options.allow?.includes(response.status)) {
						// GitHub asks to wait this long when rate limiting.
						const wait = Number(response.headers.get("retry-after"));
						if (response.status === 429 && wait > 0) {
							await clock.sleep(Math.min(wait, 60) * 1000);
						}
						throw new GitHubError(
							response.status,
							`GitHub responded ${response.status} to ${method} ${url}: ${text}`,
						);
					}
					return {
						status: response.status,
						data: (text ? JSON.parse(text) : null) as never,
					};
				},
				{ attempts: options.attempts ?? 5, retryIf: isTransient },
			),
	};
}
