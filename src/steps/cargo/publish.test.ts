import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useFakeCommands } from "../../testing/commands.ts";
import { released, root, runStep } from "../../testing/step.ts";
import { cargoPublish } from "./publish.ts";

const commands = useFakeCommands();

let cwd: string;

beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "rylease-"));
	vi.stubEnv("CARGO_REGISTRY_TOKEN", "");
	await commands.define("cargo");
});

afterEach(async () => {
	await rm(cwd, { recursive: true, force: true });
});

async function files(files: Record<string, string>) {
	for (const [path, content] of Object.entries(files)) {
		await mkdir(join(cwd, path, ".."), { recursive: true });
		await writeFile(join(cwd, path), content);
	}
}

const component = { ...root, name: "cli", path: "crates/cli" };

function run(
	options: Parameters<typeof cargoPublish>[0] = {},
	{ dryRun = false, at = root } = {},
) {
	return runStep(cargoPublish(options), released("1.1.0", { component: at }), {
		cwd,
		dryRun,
	});
}

describe("cargo/publish", () => {
	it("publishes to crates.io, with the token", async () => {
		await files({
			"Cargo.toml": '[package]\nname = "app"\nversion = "1.1.0"\n',
		});
		expect(await run({ token: "secret" })).toEqual({
			output: {
				name: "app",
				version: "1.1.0",
				registry: "crates.io",
				published: true,
			},
			reason: "published app@1.1.0 to crates.io",
		});
		const [call] = await commands.calls();
		expect(call?.args).toEqual(["publish"]);
		expect(call?.env.CARGO_REGISTRY_TOKEN).toBe("secret");
	});

	it("publishes to another registry, a crate inheriting the workspace's version", async () => {
		await files({
			"Cargo.toml":
				'[workspace]\nmembers = ["crates/*"]\n\n[workspace.package]\nversion = "1.1.0"\n',
			"crates/cli/Cargo.toml":
				'[package]\nname = "cli"\nversion.workspace = true\n',
		});
		expect(
			(await run({ registry: "my-corp", token: "secret" }, { at: component }))
				.reason,
		).toBe("published cli@1.1.0 to my-corp");
		const [call] = await commands.calls();
		expect(call?.args).toEqual(["publish", "--registry", "my-corp"]);
		expect(call?.cwd).toMatch(/crates\/cli$/);
		expect(call?.env.CARGO_REGISTRIES_MY_CORP_TOKEN).toBe("secret");
	});

	it("only says what it would publish in a dry run", async () => {
		await files({
			"Cargo.toml": '[package]\nname = "app"\nversion = "1.0.0"\n',
		});
		expect((await run({}, { dryRun: true })).reason).toBe(
			"would cargo publish app@1.1.0 to crates.io",
		);
		expect(await commands.calls()).toEqual([]);
	});

	it("refuses to publish another version, or what isn't published", async () => {
		await files({
			"Cargo.toml":
				'[workspace]\nmembers = ["crates/*"]\n\n[workspace.package]\nversion = "1.0.0"\n',
			"crates/cli/Cargo.toml":
				'[package]\nname = "cli"\nversion.workspace = true\n',
		});
		await expect(run({}, { at: component })).rejects.toThrow(
			"Cargo.toml is at 1.0.0, not 1.1.0; write it first (fs/write-version, with format: cargo)",
		);
		await files({
			"Cargo.toml":
				'[package]\nname = "app"\nversion = "1.1.0"\npublish = false\n',
		});
		await expect(run({}, { dryRun: true })).rejects.toThrow(
			"Cargo.toml has 'publish = false'; cargo won't publish it",
		);
		await files({ "Cargo.toml": '[workspace]\nmembers = ["a"]\n' });
		await expect(run({}, { dryRun: true })).rejects.toThrow(
			"Cargo.toml has no [package] 'name'",
		);
		expect(await commands.calls()).toEqual([]);
	});
});
