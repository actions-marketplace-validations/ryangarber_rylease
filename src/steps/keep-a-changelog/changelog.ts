/** The `## [Unreleased]` heading of a Keep a Changelog file. */
const UNRELEASED = /^##\s+\[?unreleased\]?\s*$/i;

export interface Unreleased {
	/** Line indices of the heading, and of the next `## ` heading or the end. */
	start: number;
	end: number;
}

/** Finds the `## [Unreleased]` section of a changelog's lines. */
export function findUnreleased(
	lines: readonly string[],
	path: string,
): Unreleased {
	const start = lines.findIndex((line) => UNRELEASED.test(line));
	if (start === -1) throw new Error(`${path} has no '## [Unreleased]' section`);
	const next = lines.findIndex((line, i) => i > start && /^##\s/.test(line));
	return { start, end: next === -1 ? lines.length : next };
}
