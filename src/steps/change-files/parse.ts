import { KINDS, type Kind } from "../../core/types.ts";

/** A change file: kinds by component, then what changed. */
export interface ChangeFile {
	/** Kinds by component name; `kind` alone stands for the only component. */
	kinds: Record<string, Kind>;
	title: string;
	description?: string;
}

/**
 * Parses a change file:
 *
 * ```md
 * ---
 * "@x/core": feature
 * cli: fix
 * ---
 * Add dark mode.
 *
 * More about it.
 * ```
 */
export function parseChangeFile(text: string, path: string): ChangeFile {
	const lines = text.replace(/^﻿/, "").split(/\r?\n/);
	if (lines[0]?.trim() !== "---") {
		throw new Error(`${path} must start with '---', then kinds by component`);
	}
	const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
	if (end === -1) throw new Error(`${path} has no closing '---'`);
	const kinds: Record<string, Kind> = {};
	for (const [i, line] of lines.slice(1, end).entries()) {
		if (line.trim() === "" || line.trim().startsWith("#")) continue;
		const match = /^\s*(?:"([^"]+)"|'([^']+)'|([^:\s]+))\s*:\s*(\S+)\s*$/.exec(
			line,
		);
		const name = match?.[1] ?? match?.[2] ?? match?.[3];
		const kind = match?.[4];
		if (name === undefined || kind === undefined) {
			throw new Error(`${path} line ${i + 2}: expected 'component: kind'`);
		}
		if (!(KINDS as readonly string[]).includes(kind)) {
			throw new Error(
				`${path} line ${i + 2}: '${kind}' isn't a kind; use ${KINDS.join(", ")}`,
			);
		}
		kinds[name] = kind as Kind;
	}
	const body = lines
		.slice(end + 1)
		.join("\n")
		.trim();
	const [title = "", ...rest] = body.split("\n");
	if (title.trim() === "")
		throw new Error(`${path} says nothing after its kinds`);
	const description = rest.join("\n").trim();
	return {
		kinds,
		title: title.trim(),
		...(description && { description }),
	};
}

/** A change file's text, as `rylease add` writes it. */
export function formatChangeFile(file: ChangeFile): string {
	const kinds = Object.entries(file.kinds).map(
		([name, kind]) =>
			`${/^[\w-]+$/.test(name) ? name : JSON.stringify(name)}: ${kind}`,
	);
	return `---\n${kinds.join("\n")}\n---\n${file.title}\n${file.description ? `\n${file.description}\n` : ""}`;
}

/** A file name from a change's title, e.g. `add-dark-mode`. */
export function slug(title: string): string {
	return (
		title
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 48)
			.replace(/-+$/, "") || "change"
	);
}
