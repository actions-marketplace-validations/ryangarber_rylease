import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

/** Extracts a zip with the system's `unzip`, checking it's well formed. */
export async function unzip(
	content: Uint8Array | undefined,
): Promise<Record<string, string>> {
	const dir = await mkdtemp(join(tmpdir(), "rylease-unzip-"));
	try {
		const file = join(dir, "artifact.zip");
		await writeFile(file, content ?? "");
		const run = promisify(execFile);
		await run("unzip", ["-q", file, "-d", join(dir, "out")]);
		const { stdout } = await run("unzip", ["-Z1", file]);
		const files: Record<string, string> = {};
		for (const name of stdout.trim().split("\n")) {
			files[name] = await readFile(join(dir, "out", name), "utf8");
		}
		return files;
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}
