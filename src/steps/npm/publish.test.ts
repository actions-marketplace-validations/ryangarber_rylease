import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { released, runStep } from "../../testing/step.ts";
import { npmPublish } from "./publish.ts";

/** A registry that accepts every publish and records it. */
let server: Server;
let registry: string;
const published: { url: string; authorization?: string; tag?: string }[] = [];

beforeAll(async () => {
	server = createServer((request, response) => {
		let body = "";
		request.on("data", (chunk) => {
			body += chunk;
		});
		request.on("end", () => {
			if (request.method === "PUT") {
				const tags = (JSON.parse(body) as { "dist-tags": object })["dist-tags"];
				published.push({
					url: request.url ?? "",
					...(request.headers.authorization && {
						authorization: request.headers.authorization,
					}),
					...(Object.keys(tags)[0] && { tag: Object.keys(tags)[0] }),
				});
			}
			response.writeHead(request.method === "PUT" ? 201 : 404, {
				"content-type": "application/json",
			});
			response.end("{}");
		});
	});
	// `once` rejects on listen errors instead of leaving setup to time out.
	const listening = once(server, "listening");
	server.listen(0);
	await listening;
	registry = `http://localhost:${(server.address() as AddressInfo).port}/`;
});

afterAll(() => {
	server.close();
});

async function withPackage(
	json: Record<string, unknown>,
	test: (cwd: string) => Promise<void>,
): Promise<void> {
	const cwd = await mkdtemp(join(tmpdir(), "rylease-"));
	try {
		await writeFile(join(cwd, "package.json"), JSON.stringify(json));
		await test(cwd);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
}

function run(step: ReturnType<typeof npmPublish>, cwd: string, dryRun = false) {
	return runStep(step, released("1.1.0"), { cwd, dryRun });
}

describe("npm/publish", () => {
	it.each(["npm", "pnpm"] as const)(
		"publishes with %s and the token",
		async (client) => {
			await withPackage(
				{ name: `@me/${client}`, version: "1.1.0" },
				async (cwd) => {
					const output = await run(
						npmPublish({ client, registry, tag: "next", token: "secret" }),
						cwd,
					);
					expect(output.reason).toBe(
						`published @me/${client}@1.1.0 to ${registry} as next`,
					);
					expect(published.at(-1)).toEqual({
						url: `/@me%2f${client}`,
						authorization: "Bearer secret",
						tag: "next",
					});
				},
			);
		},
		60_000,
	);

	it("reads publishConfig and detects the client", async () => {
		await withPackage(
			{
				name: "pkg",
				version: "1.0.0",
				packageManager: "pnpm@12.0.0",
				publishConfig: { registry, tag: "beta" },
			},
			async (cwd) => {
				expect(await run(npmPublish(), cwd, true)).toEqual({
					output: {
						name: "pkg",
						version: "1.1.0",
						client: "pnpm",
						tag: "beta",
						registry,
						published: false,
					},
					reason: `would pnpm publish pkg@1.1.0 to ${registry} as beta`,
				});
			},
		);
	});

	it("detects the client from the closest lockfile", async () => {
		const clientIn = async (files: Record<string, string>) => {
			const root = await mkdtemp(join(tmpdir(), "rylease-"));
			try {
				await mkdir(join(root, "packages", "a"), { recursive: true });
				for (const [name, content] of Object.entries(files)) {
					await writeFile(join(root, name), content);
				}
				const output = await run(
					npmPublish({ path: "packages/a", registry }),
					root,
					true,
				);
				return (output.output as { client: string }).client;
			} finally {
				await rm(root, { recursive: true, force: true });
			}
		};
		const manifest = JSON.stringify({ name: "a", version: "1.1.0" });
		expect(
			await clientIn({
				"packages/a/package.json": manifest,
				"pnpm-lock.yaml": "",
			}),
		).toBe("pnpm");
		expect(
			await clientIn({
				"packages/a/package.json": manifest,
				"packages/a/package-lock.json": "{}",
				"pnpm-lock.yaml": "",
			}),
		).toBe("npm");
		expect(
			await clientIn({
				"packages/a/package.json": JSON.stringify({
					name: "a",
					version: "1.1.0",
					packageManager: "npm@11.0.0",
				}),
				"pnpm-lock.yaml": "",
			}),
		).toBe("npm");
	});

	it("refuses to publish another version", async () => {
		await withPackage({ name: "pkg", version: "1.0.0" }, async (cwd) => {
			await expect(run(npmPublish({ registry }), cwd)).rejects.toThrow(
				"package.json is at 1.0.0, not 1.1.0",
			);
		});
	});

	it("refuses private and unnamed packages", async () => {
		await withPackage(
			{ name: "pkg", version: "1.1.0", private: true },
			async (cwd) => {
				await expect(run(npmPublish(), cwd, true)).rejects.toThrow(
					"package.json is private; npm won't publish it",
				);
			},
		);
		await withPackage({ version: "1.1.0" }, async (cwd) => {
			await expect(run(npmPublish(), cwd, true)).rejects.toThrow(
				"package.json has no 'name'",
			);
		});
	});
});
