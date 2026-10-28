import { readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The rylease package to run with: the one given, e.g. by the `rylease` that
 * ran this CLI, then `RYLEASE_ENGINE`, then the project's; `undefined` for
 * the CLI's own. Versions without what the CLI needs are passed over.
 */
export function engineRoot(cwd: string, given?: string): string | undefined {
	return [given, process.env.RYLEASE_ENGINE, projectEngine(cwd)].find(
		(root): root is string => root !== undefined && root !== "" && usable(root),
	);
}

function projectEngine(cwd: string): string | undefined {
	try {
		return dirname(
			createRequire(join(cwd, "package.json")).resolve("rylease/package.json"),
		);
	} catch {
		return undefined;
	}
}

function usable(root: string): boolean {
	try {
		const manifest = JSON.parse(
			readFileSync(join(root, "package.json"), "utf8"),
		) as { name?: unknown; exports?: Record<string, unknown> };
		return (
			manifest.name === "rylease" && "./internal" in (manifest.exports ?? {})
		);
	} catch {
		return false;
	}
}

let used = false;

/**
 * Resolves `rylease` and `rylease/...` from `root`, or the CLI's own, for the
 * CLI and every custom step it loads, so all of them share one rylease.
 */
export function useEngine(root: string | undefined): void {
	if (used) return;
	used = true;
	const parentURL = root
		? pathToFileURL(join(root, "package.json")).href
		: import.meta.url;
	registerHooks({
		resolve: (specifier, context, next) =>
			specifier === "rylease" || specifier.startsWith("rylease/")
				? next(specifier, { ...context, parentURL })
				: next(specifier, context),
	});
}
