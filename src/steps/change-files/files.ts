import { readdir, readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { z } from "../../core/options.ts";
import { type ChangeFile, parseChangeFile } from "./parse.ts";

export const directoryOption = z
	.string()
	.default(".changes")
	.describe("Where change files are kept, relative to the project.");

/** Every change file in the directory, parsed, by its path in the project. */
export async function readChangeFiles(
	cwd: string,
	directory: string,
): Promise<{ path: string; file: ChangeFile }[]> {
	const names = await readdir(join(cwd, directory)).catch((error: unknown) => {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	});
	const files = [];
	for (const name of names.filter((name) => name.endsWith(".md")).sort()) {
		if (name.toLowerCase() === "readme.md") continue;
		const path = posix.join(directory.replaceAll("\\", "/"), name);
		files.push({
			path,
			file: parseChangeFile(await readFile(join(cwd, path), "utf8"), path),
		});
	}
	return files;
}

/**
 * The kind a change file gives a component: its own, or `kind` when the
 * component is the only one.
 */
export function kindFor(
	file: ChangeFile,
	component: string,
	only: boolean,
): string | undefined {
	return file.kinds[component] ?? (only ? file.kinds.kind : undefined);
}
