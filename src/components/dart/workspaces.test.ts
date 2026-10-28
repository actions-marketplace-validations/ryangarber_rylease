import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dartWorkspaces } from "./workspaces.ts";

let cwd: string;

beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "rylease-"));
});

afterEach(async () => {
	await rm(cwd, { recursive: true, force: true });
});

const env = () => ({ cwd, branch: "main", dryRun: false });

async function workspace(files: Record<string, string>) {
	for (const [path, content] of Object.entries(files)) {
		await mkdir(join(cwd, path, ".."), { recursive: true });
		await writeFile(join(cwd, path), content);
	}
}

describe("dart/workspaces", () => {
	// Laid out like a Flutter app with its packages beside it.
	const app = {
		"pubspec.yaml":
			'name: app\npublish_to: "none"\nversion: 0.1.0+1\nworkspace:\n  - packages/dev\n  - packages/shared\n  - packages/unversioned\ndependencies:\n  flutter:\n    sdk: flutter\n  shared: any\n',
		"packages/shared/pubspec.yaml":
			"name: shared\nversion: 0.0.0\nresolution: workspace\n",
		"packages/dev/pubspec.yaml":
			"name: dev\nversion: 0.0.0\npublish_to: none\nresolution: workspace\ndependencies:\n  shared: any\ndev_dependencies:\n  app:\n    path: ../..\n",
		"packages/unversioned/pubspec.yaml":
			"name: unversioned\nresolution: workspace\n",
	};

	it("finds the packages of a pub workspace, and the root with a version", async () => {
		await workspace(app);
		expect(await dartWorkspaces().resolve(env())).toEqual([
			{ name: "shared", path: "packages/shared", dependsOn: [] },
		]);
		expect(await dartWorkspaces({ private: true }).resolve(env())).toEqual([
			{ name: "app", path: ".", dependsOn: ["shared"] },
			{ name: "dev", path: "packages/dev", dependsOn: ["shared", "app"] },
			{ name: "shared", path: "packages/shared", dependsOn: [] },
		]);
		const some = await dartWorkspaces({
			private: true,
			exclude: ["dev"],
		}).resolve(env());
		expect(some.map(({ name }) => name)).toEqual(["app", "shared"]);
	});

	it("finds the packages listed in melos.yaml", async () => {
		await workspace({
			"pubspec.yaml": "name: root\n",
			"melos.yaml": "name: root\npackages:\n  - packages/*\n",
			"packages/a/pubspec.yaml": "name: a\nversion: 1.0.0\n",
			"packages/b/pubspec.yaml":
				"name: b\nversion: 1.0.0\ndependencies:\n  a: ^1.0.0\n",
		});
		expect(await dartWorkspaces().resolve(env())).toEqual([
			{ name: "a", path: "packages/a", dependsOn: [] },
			{ name: "b", path: "packages/b", dependsOn: ["a"] },
		]);
	});

	it("needs a workspace with versioned packages", async () => {
		await workspace({ "pubspec.yaml": "name: root\nversion: 1.0.0\n" });
		await expect(dartWorkspaces().resolve(env())).rejects.toThrow(
			"no workspace: list its packages in pubspec.yaml `workspace`, or in melos.yaml `packages`",
		);
		await workspace({
			"pubspec.yaml": "name: root\npublish_to: none\nworkspace: [a]\n",
			"a/pubspec.yaml": "name: a\n",
		});
		await expect(dartWorkspaces().resolve(env())).rejects.toThrow(
			`no workspace packages with a version in ${cwd}`,
		);
	});
});
