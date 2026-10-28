import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { shim } from "./cli.ts";

describe("rylease", () => {
	let cwd: string;
	beforeEach(async () => {
		cwd = await mkdtemp(join(tmpdir(), "rylease-shim-"));
		await writeFile(join(cwd, "package.json"), "{}\n");
	});
	afterEach(() => rm(cwd, { recursive: true, force: true }));

	it("runs the project's @rylease/cli, with this rylease", async () => {
		const cli = join(cwd, "node_modules/@rylease/cli");
		await mkdir(cli, { recursive: true });
		await writeFile(
			join(cli, "package.json"),
			JSON.stringify({
				name: "@rylease/cli",
				type: "module",
				exports: "./index.js",
			}),
		);
		await writeFile(
			join(cli, "index.js"),
			"export const run = async (argv, options) => { globalThis.ran = { argv, options }; return 3; };\n",
		);
		const fallback = vi.fn(async () => 0);
		expect(await shim(["add", "x"], { cwd, fallback })).toBe(3);
		expect(fallback).not.toHaveBeenCalled();
		expect((globalThis as { ran?: unknown }).ran).toEqual({
			argv: ["add", "x"],
			options: { engine: fileURLToPath(new URL("..", import.meta.url)) },
		});
	});

	it("falls back to npx without one", async () => {
		const fallback = vi.fn(async () => 2);
		// Under pnpm, NODE_PATH would find the workspace's.
		const installed = async () => undefined;
		expect(await shim(["--dry-run"], { cwd, installed, fallback })).toBe(2);
		expect(fallback).toHaveBeenCalledWith(["--dry-run"]);
	});
});
