import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatSize, resolveFiles } from "./files.ts";

let cwd: string;

beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "rylease-files-"));
	await mkdir(join(cwd, "dist", "nested"), { recursive: true });
	await mkdir(join(cwd, "empty"));
	await writeFile(join(cwd, "dist", "b.exe"), "");
	await writeFile(join(cwd, "dist", "a.zip"), "");
	await writeFile(join(cwd, "dist", "nested", "c.json"), "");
});

afterEach(async () => {
	await rm(cwd, { recursive: true, force: true });
});

describe("resolveFiles", () => {
	it("resolves globs, paths and directories to sorted, unique files", async () => {
		expect(
			await resolveFiles(cwd, [
				"dist/*.exe",
				"dist",
				join(cwd, "dist", "a.zip"),
			]),
		).toEqual([
			join(cwd, "dist", "a.zip"),
			join(cwd, "dist", "b.exe"),
			join(cwd, "dist", "nested", "c.json"),
		]);
	});

	it("takes backslashes as separators", async () => {
		expect(await resolveFiles(cwd, ["dist\\nested\\*.json"])).toEqual([
			join(cwd, "dist", "nested", "c.json"),
		]);
	});

	it("fails on a pattern that matches no files", async () => {
		await expect(resolveFiles(cwd, ["dist", "*.dmg"])).rejects.toThrow(
			"no files match '*.dmg'",
		);
		await expect(resolveFiles(cwd, ["empty"])).rejects.toThrow(
			"no files match 'empty'",
		);
	});
});

describe("formatSize", () => {
	it.each([
		[0, "0 B"],
		[999, "999 B"],
		[1000, "1.0 kB"],
		[340_500, "340.5 kB"],
		[1_200_000, "1.2 MB"],
		[5e12, "5000.0 GB"],
	])("%i → %s", (bytes, text) => {
		expect(formatSize(bytes)).toBe(text);
	});
});
