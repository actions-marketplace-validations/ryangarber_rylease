import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadJson } from "../../utils/files.ts";

/**
 * The `packages:` list of a pnpm-workspace.yaml, in block style; negated
 * patterns are left out.
 */
function pnpmPackages(text: string): string[] {
	const patterns: string[] = [];
	let inPackages = false;
	for (const line of text.split(/\r?\n/)) {
		if (/^packages:\s*$/.test(line)) {
			inPackages = true;
			continue;
		}
		if (!inPackages) continue;
		const item = /^\s+-\s+(.+?)\s*$/.exec(line);
		if (item?.[1]) {
			const pattern =
				/^(['"])(.*)\1$/.exec(item[1])?.[2] ?? item[1].replace(/\s+#.*$/, "");
			if (!pattern.startsWith("!")) patterns.push(pattern);
		} else if (/^\S/.test(line)) {
			inPackages = false;
		}
	}
	return patterns;
}

/** Globs of the workspace's packages, from pnpm-workspace.yaml or package.json. */
export async function getPackages(cwd: string): Promise<string[]> {
	const pnpm = await readFile(join(cwd, "pnpm-workspace.yaml"), "utf8").catch(
		() => undefined,
	);
	if (pnpm !== undefined) {
		const patterns = pnpmPackages(pnpm);
		if (patterns.length > 0) return patterns;
	}
	const json = await loadJson(join(cwd, "package.json")).catch(() => ({}));
	const workspaces = (json as { workspaces?: unknown }).workspaces;
	const list = Array.isArray(workspaces)
		? workspaces
		: (workspaces as { packages?: unknown } | undefined)?.packages;
	if (!Array.isArray(list) || list.length === 0) {
		throw new Error(
			"no workspaces: list them in package.json `workspaces`, or in pnpm-workspace.yaml `packages`",
		);
	}
	return list.filter((item): item is string => typeof item === "string");
}
