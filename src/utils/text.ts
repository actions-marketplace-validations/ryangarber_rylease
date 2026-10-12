export function plural(
	count: number,
	noun: string,
	nouns = `${noun}s`,
): string {
	return `${count} ${count === 1 ? noun : nouns}`;
}

/** `a`, `a and b`, `a, b and c`. */
export function joinList(parts: readonly string[]): string {
	return parts.length > 1
		? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`
		: (parts[0] ?? "");
}
