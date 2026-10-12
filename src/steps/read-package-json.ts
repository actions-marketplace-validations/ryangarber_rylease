import { join } from "node:path";
import { defineStep } from "../define.ts";
import { z } from "../options.ts";
import { assertFullHistory, tryGit } from "../utils/git.ts";
import { loadPackageJson, versionOf } from "../utils/package-json.ts";

/**
 * Reads the previous version from `package.json`, and its ref: the commit that
 * set that version in the file.
 */
export const readPackageJson = defineStep({
	type: "previous-version",
	name: "read-package-json",
	description:
		"Reads `version` from `package.json`, and the commit that set it as the ref.",
	options: {
		path: z
			.string()
			.default("package.json")
			.describe("Relative to the working directory."),
	},
	run: async ({ env, options: { path } }) => {
		const json = await loadPackageJson(join(env.cwd, path));
		const version = versionOf(json, path);
		const ref = await findVersionCommit(env.cwd, path, version);
		return {
			version,
			...(ref ? { ref } : {}),
			reason: ref
				? `${version} in ${path}, set in ${ref.slice(0, 7)}`
				: `${version} in ${path}, not in git history`,
		};
	},
});

/** Finds the oldest commit of the latest run of commits where the file had `version`. */
async function findVersionCommit(
	cwd: string,
	file: string,
	version: string,
): Promise<string | undefined> {
	const log = await tryGit(cwd, "log", "--format=%H", "--", file);
	if (log === undefined) return undefined; // not a git repository
	await assertFullHistory(cwd);
	let found: string | undefined;
	for (const sha of log.split("\n").filter(Boolean)) {
		if ((await versionAt(cwd, sha, file)) !== version) break;
		found = sha;
	}
	return found;
}

async function versionAt(
	cwd: string,
	sha: string,
	file: string,
): Promise<string | undefined> {
	const text = await tryGit(cwd, "show", `${sha}:./${file}`);
	if (text === undefined) return undefined;
	try {
		const json = JSON.parse(text) as { version?: unknown };
		return typeof json.version === "string" ? json.version : undefined;
	} catch {
		return undefined;
	}
}
