import { readFile, writeFile } from "node:fs/promises";

export async function loadPackageJson(
	path: string,
): Promise<Record<string, unknown>> {
	const text = await readFile(path, "utf8");
	return JSON.parse(text) as Record<string, unknown>;
}

export function versionOf(
	json: Record<string, unknown>,
	source: string,
): string {
	if (typeof json.version !== "string" || json.version === "") {
		throw new Error(`${source} has no 'version'`);
	}
	return json.version;
}

/** Sets `version`, keeping the file's indentation and trailing newline. */
export async function writePackageJsonVersion(
	path: string,
	version: string,
): Promise<void> {
	const text = await readFile(path, "utf8");
	const json = JSON.parse(text) as Record<string, unknown>;
	json.version = version;
	const indent = /^[ \t]+(?=")/m.exec(text)?.[0] ?? "\t";
	const newline = text.endsWith("\n") ? "\n" : "";
	await writeFile(path, JSON.stringify(json, null, indent) + newline);
}
