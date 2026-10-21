import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { useRepo } from "../../testing/repo.ts";
import { npmWorkspaces } from "./workspaces.ts";

const repo = useRepo();

const env = (cwd = repo.cwd) => ({ cwd, branch: "main", dryRun: false });

describe("npm/workspaces", () => {
	const manifest = (name: string, extra: object = {}) =>
		JSON.stringify({ name, version: "1.0.0", ...extra });

	async function workspace(files: Record<string, string>) {
		for (const [path, content] of Object.entries(files)) {
			await mkdir(join(repo.cwd, path, ".."), { recursive: true });
			await writeFile(join(repo.cwd, path), content);
		}
	}

	it("finds the packages of a pnpm workspace, and what they depend on", async () => {
		await workspace({
			"pnpm-workspace.yaml":
				"packages:\n  - 'packages/*'\n  - apps/web\n  - '!packages/skip'\nother: 1\n",
			"packages/core/package.json": manifest("@x/core"),
			"packages/cli/package.json": manifest("@x/cli", {
				dependencies: { "@x/core": "workspace:*", zod: "^4" },
			}),
			"packages/private/package.json": manifest("@x/private", {
				private: true,
			}),
			"apps/web/package.json": manifest("web", {
				devDependencies: { "@x/cli": "^1.0.0", "@x/private": "*" },
			}),
		});
		expect(await npmWorkspaces().resolve(env())).toEqual([
			{ name: "web", path: "apps/web", dependsOn: ["@x/cli"] },
			{ name: "@x/cli", path: "packages/cli", dependsOn: ["@x/core"] },
			{ name: "@x/core", path: "packages/core", dependsOn: [] },
		]);
		const all = await npmWorkspaces({
			private: true,
			exclude: ["web"],
		}).resolve(env());
		expect(all.map(({ name }) => name)).toEqual([
			"@x/cli",
			"@x/core",
			"@x/private",
		]);
	});

	it("finds the packages listed in package.json", async () => {
		await workspace({
			"package.json": manifest("root", {
				workspaces: { packages: ["libs/*"] },
			}),
			"libs/a/package.json": manifest("a"),
		});
		expect(await npmWorkspaces().resolve(env())).toEqual([
			{ name: "a", path: "libs/a", dependsOn: [] },
		]);
	});

	it("needs workspaces", async () => {
		await expect(npmWorkspaces().resolve(env())).rejects.toThrow(
			"no workspaces: list them in package.json `workspaces`, or in pnpm-workspace.yaml `packages`",
		);
	});
});
