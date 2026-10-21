export function versionOf(
	json: Record<string, unknown>,
	source: string,
): string {
	if (typeof json.version !== "string" || json.version === "") {
		throw new Error(`${source} has no 'version'`);
	}
	return json.version;
}

const DEPENDENCY_FIELDS = [
	"dependencies",
	"devDependencies",
	"peerDependencies",
	"optionalDependencies",
] as const;

/**
 * A package.json's text with a new `version`, and with dependencies on the
 * given packages pointed at theirs, keeping each range's operator (`^`, `~`,
 * `>=` or none). `workspace:`, `file:` and ranges like `1.x` are left for the
 * package manager. Its indentation and trailing newline are kept.
 */
export function setPackageJsonVersion(
	text: string,
	version: string,
	packages: ReadonlyMap<string, string>,
): { text: string; dependencies: string[] } {
	const json = JSON.parse(text) as Record<string, unknown>;
	json.version = version;
	const changed: string[] = [];
	for (const field of DEPENDENCY_FIELDS) {
		const deps = json[field] as Record<string, unknown> | undefined;
		if (typeof deps !== "object" || deps === null) continue;
		for (const [name, range] of Object.entries(deps)) {
			const next = packages.get(name);
			if (next === undefined || typeof range !== "string") continue;
			const updated = withOperator(range, next);
			if (updated === undefined || updated === range) continue;
			deps[name] = updated;
			changed.push(`${name}@${updated}`);
		}
	}
	const indent = /^[ \t]+(?=")/m.exec(text)?.[0] ?? "\t";
	const newline = text.endsWith("\n") ? "\n" : "";
	return {
		text: JSON.stringify(json, null, indent) + newline,
		dependencies: [...new Set(changed)],
	};
}

/**
 * A range pointed at a new version, keeping its operator, or `undefined`
 * when it isn't a plain range on one version.
 */
export function withOperator(
	range: string,
	version: string,
): string | undefined {
	const match = /^(\^|~|>=|=)?v?\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.+-]+)?$/.exec(
		range.trim(),
	);
	return match ? `${match[1] ?? ""}${version}` : undefined;
}
