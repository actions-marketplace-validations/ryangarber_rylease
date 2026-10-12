import type { Change, Kind } from "../types.ts";

/** A conventional commit header, e.g. `feat(api)!: drop node 18`. */
const HEADER = /^([a-z][\w-]*)(?:\(([^()]*)\))?(!)?: (.+)$/;
const BREAKING = /\bBREAKING(?:[ -]CHANGES?)?\b/;

export interface Section {
	/** The header line, e.g. `fix(x)!: handle nulls`. */
	title: string;
	/** Lines following the header, up to the next header. */
	description?: string;
}

export interface Title {
	type: string;
	scope?: string;
	breaking: boolean;
	subject: string;
}

/**
 * Splits a commit message into conventional sections. Every line that looks
 * like a conventional header starts a new section, so squashed messages with
 * several entries yield several sections. Types must start lowercase, so
 * footers like `Refs: #12` aren't mistaken for headers. Text before the first
 * header (e.g. a merge commit's subject) is ignored.
 */
export function parseSections(message: string): Section[] {
	const sections: { title: string; lines: string[] }[] = [];
	for (const line of message.split(/\r?\n/)) {
		if (HEADER.test(line.trim())) {
			sections.push({ title: line.trim(), lines: [] });
		} else {
			sections.at(-1)?.lines.push(line);
		}
	}
	return sections.map(({ title, lines }) => {
		const description = lines.join("\n").trim();
		return description ? { title, description } : { title };
	});
}

export function parseTitle(title: string): Title | undefined {
	const match = HEADER.exec(title.trim());
	if (!match) return undefined;
	const [, type = "", scope, bang, subject = ""] = match;
	return {
		type,
		...(scope ? { scope } : {}),
		breaking: bang === "!",
		subject,
	};
}

/** Whether a text mentions a breaking change (`BREAKING CHANGE:`, `BREAKING-CHANGE`, ...). */
export function mentionsBreaking(text: string | undefined): boolean {
	return text !== undefined && BREAKING.test(text);
}

/**
 * How a change maps to a kind: `types` by `type(scope)` first, then by `type`;
 * anything else, untyped changes included, is `fallback`.
 */
export interface KindRules {
	types: Readonly<Record<string, Kind>>;
	fallback: Kind;
}

/** `!` or `BREAKING` → major; otherwise by the rules (by default `feat` → minor, the rest → patch). */
export function classify(
	change: Change,
	rules: KindRules = { types: { feat: "minor" }, fallback: "patch" },
): { kind: Kind; reason: string } {
	const source = `(${change.reason})`;
	const title =
		change.title === undefined ? undefined : parseTitle(change.title);
	const prefix = title
		? `${title.type}${title.scope ? `(${title.scope})` : ""}${title.breaking ? "!" : ""}`
		: undefined;
	if (title?.breaking) {
		return { kind: "major", reason: `'${prefix}' in title ${source}` };
	}
	if (mentionsBreaking(change.title)) {
		return { kind: "major", reason: `'BREAKING' in title ${source}` };
	}
	if (mentionsBreaking(change.description)) {
		return { kind: "major", reason: `'BREAKING' in description ${source}` };
	}
	if (!title) {
		return { kind: rules.fallback, reason: `untyped change ${source}` };
	}
	return {
		kind: typeKey(title, rules.types) ?? rules.fallback,
		reason: `'${prefix}' in title ${source}`,
	};
}

/** Looks up `type(scope)`, then `type`, in a map keyed by either. */
export function typeKey<V>(
	title: Title,
	map: Readonly<Record<string, V>>,
): V | undefined {
	const scoped = title.scope ? map[`${title.type}(${title.scope})`] : undefined;
	return scoped ?? map[title.type];
}
