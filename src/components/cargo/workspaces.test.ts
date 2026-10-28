import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cargoWorkspaces } from "./workspaces.ts";

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

const crate = (name: string, rest = "") =>
	`[package]\nname = "${name}"\nversion = "1.0.0"\n${rest}`;

describe("cargo/workspaces", () => {
	it("finds the crates of a workspace, and what they depend on", async () => {
		await workspace({
			"Cargo.toml": `${crate("app", '\n[dependencies]\ncli = { path = "crates/cli" }\n')}\n[workspace]\nmembers = [\n  "crates/*", # every crate\n]\nexclude = ["crates/skip"]\n`,
			"crates/core/Cargo.toml": crate("core"),
			"crates/cli/Cargo.toml": crate(
				"cli",
				'\n[dependencies]\nserde = "1"\n\n[target.\'cfg(unix)\'.dependencies]\ncore = { path = "../core", version = "1.0.0" }\n\n[dev-dependencies.macros]\npath = "../macros"\n',
			),
			"crates/macros/Cargo.toml": crate("macros", "publish = false\n"),
			"crates/shared/Cargo.toml":
				'[package]\nname = "shared"\nversion.workspace = true\n',
			"crates/skip/Cargo.toml": crate("skip"),
		});
		expect(await cargoWorkspaces().resolve(env())).toEqual([
			{ name: "app", path: ".", dependsOn: ["cli"] },
			{ name: "cli", path: "crates/cli", dependsOn: ["core"] },
			{ name: "core", path: "crates/core", dependsOn: [] },
		]);
		const all = await cargoWorkspaces({
			private: true,
			exclude: ["app"],
		}).resolve(env());
		expect(all).toEqual([
			{ name: "cli", path: "crates/cli", dependsOn: ["core", "macros"] },
			{ name: "core", path: "crates/core", dependsOn: [] },
			{ name: "macros", path: "crates/macros", dependsOn: [] },
		]);
	});

	it("needs a workspace with versioned crates", async () => {
		await expect(cargoWorkspaces().resolve(env())).rejects.toThrow(
			"no workspace: list its crates in Cargo.toml's [workspace] `members`",
		);
		await workspace({
			"Cargo.toml": '[workspace]\nmembers = ["a"]\n',
			"a/Cargo.toml": '[package]\nname = "a"\nversion.workspace = true\n',
		});
		await expect(cargoWorkspaces().resolve(env())).rejects.toThrow(
			`no workspace crates with a version in ${cwd}`,
		);
	});
});
