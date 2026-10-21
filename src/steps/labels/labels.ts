import type { Change } from "../../core/types.ts";

/** Labels compare case-insensitively, as GitHub's do. */
export function hasLabel(change: Change, labels: readonly string[]): boolean {
	const wanted = labels.map((label) => label.toLowerCase());
	return (change.labels ?? []).some((label) =>
		wanted.includes(label.toLowerCase()),
	);
}

/** Looks a label up in a map keyed by labels, ignoring case. */
export function lookup<V>(
	map: Readonly<Record<string, V>>,
	label: string,
): V | undefined {
	const key = Object.keys(map).find(
		(other) => other.toLowerCase() === label.toLowerCase(),
	);
	return key === undefined ? undefined : map[key];
}
