import type { Fact } from "../../core/facts.ts";
import { setPackageJsonVersion, withOperator } from "../npm/package-json.ts";

/**
 * Where a kind of project keeps its version, and how to read and write it,
 * keeping everything else in the file as it was.
 */
export interface VersionFormat {
	name: string;
	/** Where it's usually kept, relative to a component's directory. */
	path: string;
	/** Facts its versions need, e.g. `version.semver` for npm. */
	needs?: readonly Fact[];
	read(text: string): string | undefined;
	/**
	 * The text with the new version; dependencies on the given packages, by
	 * name, are pointed at theirs where the format knows how.
	 */
	write(
		text: string,
		version: string,
		packages: ReadonlyMap<string, string>,
	): { text: string; dependencies: string[] };
	/** The package's name, for other packages' dependencies on it. */
	packageName?(text: string): string | undefined;
}

export const FORMAT_NAMES = [
	"plain",
	"npm",
	"cargo",
	"python",
	"helm",
	"gradle",
	"maven",
	"pattern",
] as const;

export type FormatName = (typeof FORMAT_NAMES)[number];

/** The format by name; `pattern` needs its template, e.g. `VERSION = "{version}"`. */
export function versionFormat(
	name: FormatName,
	pattern?: string,
): VersionFormat {
	switch (name) {
		case "plain":
			return plain;
		case "npm":
			return npm;
		case "cargo":
			return cargo;
		case "python":
			return python;
		case "helm":
			return helm;
		case "gradle":
			return gradle;
		case "maven":
			return maven;
		case "pattern":
			if (pattern === undefined) {
				throw new Error("the pattern format needs a `pattern`");
			}
			return fromPattern(pattern);
	}
}

const unchanged = (text: string) => ({ text, dependencies: [] });

const plain: VersionFormat = {
	name: "plain",
	path: "VERSION",
	read: (text) => text.trim() || undefined,
	// Keep the file's trailing newline, or lack of one; new files get one.
	write: (text, version) =>
		unchanged(`${version}${text === "" || text.endsWith("\n") ? "\n" : ""}`),
};

const npm: VersionFormat = {
	name: "npm",
	path: "package.json",
	needs: ["version.semver"],
	read: (text) => {
		const json = parseJson(text);
		return typeof json?.version === "string" && json.version !== ""
			? json.version
			: undefined;
	},
	write: setPackageJsonVersion,
	packageName: (text) => {
		const name = parseJson(text)?.name;
		return typeof name === "string" ? name : undefined;
	},
};

function parseJson(text: string): Record<string, unknown> | undefined {
	try {
		const json: unknown = JSON.parse(text);
		return typeof json === "object" && json !== null
			? (json as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

/** `key = "value"` in the first of the TOML tables that has it. */
function tomlKey(tables: readonly string[], key: string) {
	const find = (text: string) => {
		const lines = text.split("\n");
		for (const table of tables) {
			let inside = false;
			for (const [index, line] of lines.entries()) {
				const header = /^\s*\[([^[\]]+)\]\s*(#.*)?$/.exec(line);
				if (header) {
					inside = header[1]?.trim() === table;
					continue;
				}
				if (/^\s*\[\[/.test(line)) {
					inside = false;
					continue;
				}
				const match = new RegExp(
					`^(\\s*${key}\\s*=\\s*)(["'])([^"']*)\\2(.*)$`,
				).exec(line);
				if (inside && match) return { lines, index, match };
			}
		}
		return undefined;
	};
	return {
		read: (text: string) => find(text)?.match[3],
		write: (text: string, value: string) => {
			const found = find(text);
			if (!found) return undefined;
			const [, before, quote, , after] = found.match;
			found.lines[found.index] = `${before}${quote}${value}${quote}${after}`;
			return found.lines.join("\n");
		},
	};
}

const CARGO_TABLES = [
	"dependencies",
	"dev-dependencies",
	"build-dependencies",
	"workspace.dependencies",
];

const cargoVersion = tomlKey(["package", "workspace.package"], "version");
const cargoName = tomlKey(["package"], "name");

const cargo: VersionFormat = {
	name: "cargo",
	path: "Cargo.toml",
	needs: ["version.semver"],
	read: cargoVersion.read,
	write: (text, version, packages) => {
		const written = cargoVersion.write(text, version);
		if (written === undefined) throw new Error("it has no [package] version");
		// `name = { path = "..", version = "1.2" }` in dependency tables.
		const dependencies: string[] = [];
		let table = "";
		const lines = written.split("\n").map((line) => {
			const header = /^\s*\[([^[\]]+)\]/.exec(line);
			if (header) table = header[1]?.trim() ?? "";
			if (!CARGO_TABLES.some((name) => table.endsWith(name))) return line;
			const match =
				/^(\s*"?([\w-]+)"?\s*=\s*\{[^}]*\bversion\s*=\s*")([^"]*)(".*)$/.exec(
					line,
				);
			const next = match?.[2] ? packages.get(match[2]) : undefined;
			const range = match?.[3];
			if (!match || next === undefined || range === undefined) return line;
			const updated = withOperator(range, next);
			if (updated === undefined || updated === range) return line;
			dependencies.push(`${match[2]}@${updated}`);
			return `${match[1]}${updated}${match[4]}`;
		});
		return { text: lines.join("\n"), dependencies };
	},
	packageName: cargoName.read,
};

const pythonVersion = tomlKey(["project", "tool.poetry"], "version");

const python: VersionFormat = {
	name: "python",
	path: "pyproject.toml",
	read: pythonVersion.read,
	write: (text, version) => {
		const written = pythonVersion.write(text, version);
		if (written === undefined) {
			throw new Error("it has no [project] or [tool.poetry] version");
		}
		return unchanged(written);
	},
};

/** A top-level `key: value` line, e.g. in YAML or a properties file. */
function lineKey(name: string, path: string, pattern: RegExp): VersionFormat {
	return {
		name,
		path,
		read: (text) => pattern.exec(text)?.[3],
		write: (text, version) => {
			if (!pattern.test(text)) throw new Error(`it has no ${name} version`);
			return unchanged(
				text.replace(
					pattern,
					(_, before: string, quote: string, __: string, after: string) =>
						`${before}${quote}${version}${quote}${after}`,
				),
			);
		},
	};
}

const helm = lineKey(
	"helm",
	"Chart.yaml",
	/^(version:\s*)(["']?)([^"'\s#]+)\2(.*)$/m,
);

const gradle = lineKey(
	"gradle",
	"gradle.properties",
	/^(\s*version\s*[=:]\s*)()([^\s#]+)()$/m,
);

/** The project's own `<version>`: the one directly in `<project>`. */
function mavenVersion(
	text: string,
): { start: number; end: number } | undefined {
	const tags = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([\w.:-]+)[^>]*?(\/?)>/g;
	let depth = 0;
	let open: number | undefined;
	for (const match of text.matchAll(tags)) {
		const [whole, closing, name, selfClosing] = match;
		if (name === undefined || selfClosing) continue;
		if (closing) {
			depth--;
			if (name === "version" && depth === 1 && open !== undefined) {
				return { start: open, end: match.index };
			}
			continue;
		}
		if (name === "version" && depth === 1) open = match.index + whole.length;
		depth++;
	}
	return undefined;
}

const maven: VersionFormat = {
	name: "maven",
	path: "pom.xml",
	read: (text) => {
		const found = mavenVersion(text);
		return found ? text.slice(found.start, found.end).trim() : undefined;
	},
	write: (text, version) => {
		const found = mavenVersion(text);
		if (!found) throw new Error("it has no project <version>");
		return unchanged(
			`${text.slice(0, found.start)}${version}${text.slice(found.end)}`,
		);
	},
};

/**
 * Versions wherever a template matches, e.g. `__version__ = "{version}"`;
 * every match is written.
 */
function fromPattern(template: string): VersionFormat {
	if (!template.includes("{version}")) {
		throw new Error(`the pattern '${template}' has no {version} placeholder`);
	}
	const source = template
		.split("{version}")
		.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
		.join("([^\\s\"'`,;<>]+)");
	const pattern = new RegExp(source, "g");
	return {
		name: "pattern",
		path: "",
		read: (text) => new RegExp(source).exec(text)?.[1],
		write: (text, version) => {
			if (!new RegExp(source).test(text)) {
				throw new Error(`nothing matches '${template}'`);
			}
			return unchanged(
				text.replace(pattern, () => template.replaceAll("{version}", version)),
			);
		},
	};
}
