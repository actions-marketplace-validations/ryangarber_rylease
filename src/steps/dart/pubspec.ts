import { withOperator } from "../npm/package-json.ts";

const VERSION = /^(version:[ \t]*)(["']?)([^"'\s#]+)\2(.*)$/m;

/** A top-level `key: value` of a pubspec, unquoted. */
export function pubspecField(text: string, key: string): string | undefined {
	return new RegExp(`^${key}:[ \\t]*(["']?)([^"'\\s#]+)\\1`, "m").exec(
		text,
	)?.[2];
}

/** A pubspec's `version` as written, with any build number, e.g. `1.2.0+3`. */
export function pubspecVersion(text: string): string | undefined {
	return VERSION.exec(text)?.[3];
}

/**
 * A version without its build number, like Flutter apps' `+3`, which isn't
 * part of the release: `1.2.0+3` was released as `1.2.0`.
 */
export function withoutBuildNumber(version: string): string {
	return version.replace(/\+\d+$/, "");
}

const DEPENDENCY_SECTIONS = /^(dependencies|dev_dependencies):[ \t]*(#.*)?$/;

/**
 * A pubspec's text with a new `version`. A build number, like Flutter apps'
 * `1.2.0+3`, is incremented, since app stores need each upload's to be
 * higher: `1.3.0+4`. Dependencies on the given packages are pointed at
 * theirs, keeping each range's operator; `any`, `path:` and ranges like
 * `>=1.0.0 <2.0.0` are left as they are.
 */
export function setPubspecVersion(
	text: string,
	version: string,
	packages: ReadonlyMap<string, string>,
): { text: string; dependencies: string[]; version: string } {
	const current = pubspecVersion(text);
	if (current === undefined) throw new Error("it has no version");
	const build = /\+(\d+)$/.exec(current)?.[1];
	const written =
		build !== undefined && !version.includes("+")
			? `${version}+${Number(build) + 1}`
			: version;
	const changed: string[] = [];
	const point = (name: string | undefined, value: string) => {
		const next = name === undefined ? undefined : packages.get(name);
		const match = /^(["']?)([^"'#]*?)\1([ \t]*(#.*)?)$/.exec(value);
		const range = match?.[2];
		if (!match || next === undefined || range === undefined) return value;
		const updated = withOperator(range, next);
		if (updated === undefined || updated === range) return value;
		changed.push(`${name}@${updated}`);
		return `${match[1]}${updated}${match[1]}${match[3]}`;
	};
	let inSection = false;
	let indent: number | undefined;
	// A dependency given as a map, e.g. with `hosted:` and `version:`.
	let block: string | undefined;
	const lines = text.split("\n").map((line) => {
		if (/^[^\s#]/.test(line)) {
			inSection = DEPENDENCY_SECTIONS.test(line);
			indent = undefined;
			block = undefined;
			return line;
		}
		if (!inSection || /^\s*(#.*)?$/.test(line)) return line;
		const width = /^\s*/.exec(line)?.[0].length ?? 0;
		indent ??= width;
		if (width === indent) {
			const entry = /^(\s+(["']?)([\w]+)\2:[ \t]*)(.*)$/.exec(line);
			const value = entry?.[4] ?? "";
			block = value === "" || value.startsWith("#") ? entry?.[3] : undefined;
			if (!entry || block !== undefined) return line;
			return `${entry[1]}${point(entry[3], value)}`;
		}
		const nested = /^(\s+version:[ \t]*)(.*)$/.exec(line);
		if (width < indent || !nested || block === undefined) return line;
		return `${nested[1]}${point(block, nested[2] ?? "")}`;
	});
	return {
		text: lines
			.join("\n")
			.replace(
				VERSION,
				(_, before: string, quote: string, __: string, after: string) =>
					`${before}${quote}${written}${quote}${after}`,
			),
		dependencies: changed,
		version: written,
	};
}
