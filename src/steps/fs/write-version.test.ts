import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { released, root, runStep } from "../../testing/step.ts";
import { fsWriteVersion } from "./write-version.ts";

let cwd: string;

beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "rylease-"));
});

afterEach(async () => {
	await rm(cwd, { recursive: true, force: true });
});

const component = (name: string) => ({
	...root,
	name,
	path: `packages/${name}`,
});

describe("fs/write-version", () => {
	it("writes the version, reporting the file for git/commit", async () => {
		expect(
			await runStep(fsWriteVersion(), released("2026.10.0"), { cwd }),
		).toEqual({
			output: {
				written: [{ path: "VERSION", version: "2026.10.0", dependencies: [] }],
			},
			files: ["VERSION"],
			reason: "wrote 2026.10.0 to VERSION",
		});
		expect(await readFile(join(cwd, "VERSION"), "utf8")).toBe("2026.10.0\n");
	});

	it("keeps a file without a trailing newline that way", async () => {
		await writeFile(join(cwd, "version.txt"), "1.0.0");
		await runStep(fsWriteVersion({ path: "version.txt" }), released("1.1.0"), {
			cwd,
		});
		expect(await readFile(join(cwd, "version.txt"), "utf8")).toBe("1.1.0");
	});

	it("only says what it would write in a dry run", async () => {
		expect(
			await runStep(fsWriteVersion(), released("1.1.0"), { cwd, dryRun: true }),
		).toMatchObject({
			output: { written: [] },
			reason: "would write 1.1.0 to VERSION",
		});
		await expect(readFile(join(cwd, "VERSION"), "utf8")).rejects.toThrow();
	});

	it("writes each component's file, and their dependencies on each other", async () => {
		const manifest = (name: string, dependencies: object) =>
			`${JSON.stringify({ name: `@x/${name}`, version: "1.0.0", dependencies }, null, 2)}\n`;
		for (const name of ["core", "cli"]) {
			await mkdir(join(cwd, "packages", name), { recursive: true });
		}
		await writeFile(
			join(cwd, "packages/core/package.json"),
			manifest("core", {}),
		);
		await writeFile(
			join(cwd, "packages/cli/package.json"),
			manifest("cli", { "@x/core": "^1.0.0" }),
		);
		const output = await runStep(
			fsWriteVersion({ format: "npm" }),
			[
				released("2.0.0", { component: component("core") }),
				released("1.0.1", { component: component("cli") }),
			],
			{ cwd },
		);
		expect(output.reason).toBe(
			"wrote 2.0.0 to packages/core/package.json and 1.0.1 to packages/cli/package.json (and @x/core@^2.0.0)",
		);
		expect(output.files).toEqual([
			"packages/core/package.json",
			"packages/cli/package.json",
		]);
	});

	it("writes every file matching a glob, for packages sharing a version", async () => {
		await writeFile(
			join(cwd, "package.json"),
			'{ "name": "x", "version": "1.0.0" }',
		);
		for (const name of ["a", "b"]) {
			await mkdir(join(cwd, "packages", name), { recursive: true });
			await writeFile(
				join(cwd, "packages", name, "package.json"),
				JSON.stringify({
					name,
					version: "1.0.0",
					dependencies: { a: "^1.0.0" },
				}),
			);
		}
		const output = await runStep(
			fsWriteVersion({
				format: "npm",
				path: ["package.json", "packages/*/package.json"],
			}),
			released("1.1.0"),
			{ cwd },
		);
		expect(output.files).toEqual([
			"package.json",
			"packages/a/package.json",
			"packages/b/package.json",
		]);
		expect(
			JSON.parse(await readFile(join(cwd, "packages/b/package.json"), "utf8")),
		).toMatchObject({ version: "1.1.0", dependencies: { a: "^1.1.0" } });
	});

	it("fails on missing files and versions it can't write", async () => {
		await expect(
			runStep(fsWriteVersion({ format: "cargo" }), released("1.1.0"), { cwd }),
		).rejects.toThrow("no files match 'Cargo.toml'");
		await writeFile(join(cwd, "Cargo.toml"), '[workspace]\nmembers = ["a"]\n');
		await expect(
			runStep(fsWriteVersion({ format: "cargo" }), released("1.1.0"), { cwd }),
		).rejects.toThrow(
			"can't write 1.1.0 to Cargo.toml: it has no [package] version",
		);
		await writeFile(join(cwd, "package.json"), '{ "version": "1.0.0" }');
		await expect(
			runStep(fsWriteVersion({ format: "npm" }), released("2026.01.0"), {
				cwd,
				dryRun: true,
			}),
		).rejects.toThrow(
			"npm needs a semantic version, and '2026.01.0' isn't one",
		);
		await expect(
			runStep(fsWriteVersion({ format: "pattern" }), released("1.0.0"), {
				cwd,
			}),
		).rejects.toThrow("the pattern format needs a `pattern`");
	});

	it("needs semantic versions for npm and cargo", () => {
		expect(fsWriteVersion({ format: "npm" }).needs).toEqual(["version.semver"]);
		expect(fsWriteVersion({ format: "cargo" }).needs).toEqual([
			"version.semver",
		]);
		expect(fsWriteVersion({ format: "python" }).needs).toBeUndefined();
	});
});
