/**
 * Just enough TOML for version files: values found by table and key, read
 * and written line by line so everything else stays as it was.
 */

/** Each line, with the table it's in; lines in `[[arrays]]` are in none. */
function tabled(text: string): { table: string | undefined; line: string }[] {
	let table: string | undefined = "";
	return text.split("\n").map((line) => {
		const header = /^\s*\[([^[\]]+)\]\s*(#.*)?$/.exec(line);
		if (header) table = header[1]?.trim();
		else if (/^\s*\[\[/.test(line)) table = undefined;
		return { table, line };
	});
}

/** `key = "value"` in the first of the tables that has it. */
export function tomlKey(tables: readonly string[], key: string) {
	const find = (text: string) => {
		const lines = tabled(text);
		for (const table of tables) {
			for (const [index, { table: inside, line }] of lines.entries()) {
				const match = new RegExp(
					`^(\\s*${key}\\s*=\\s*)(["'])([^"']*)\\2(.*)$`,
				).exec(line);
				if (inside === table && match) {
					return { lines: lines.map(({ line }) => line), index, match };
				}
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

/** A line without its comment, if it has one outside a string. */
function uncommented(line: string): string {
	let quote: string | undefined;
	for (const [index, char] of [...line].entries()) {
		if (quote) {
			if (char === quote) quote = undefined;
		} else if (char === '"' || char === "'") {
			quote = char;
		} else if (char === "#") {
			return line.slice(0, index);
		}
	}
	return line;
}

/**
 * The raw value of `key` in `table`, without comments, e.g. `false` or
 * `["a", "b"]`; an array may span lines.
 */
export function tomlValue(
	text: string,
	table: string,
	key: string,
): string | undefined {
	const lines = tabled(text);
	const pattern = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`);
	for (const [index, { table: inside, line }] of lines.entries()) {
		const match = inside === table ? pattern.exec(uncommented(line)) : null;
		if (!match) continue;
		let value = match[1]?.trim() ?? "";
		const depth = (text: string) =>
			[...text].reduce(
				(sum, char) => sum + (char === "[" ? 1 : char === "]" ? -1 : 0),
				0,
			);
		for (const { line: next } of lines.slice(index + 1)) {
			if (depth(value) <= 0) break;
			value += ` ${uncommented(next).trim()}`;
		}
		return value;
	}
	return undefined;
}

/** The strings in a raw TOML array, e.g. `["a", 'b']`. */
export function tomlStrings(value: string | undefined): string[] {
	return [...(value ?? "").matchAll(/"([^"]*)"|'([^']*)'/g)].map(
		([, double, single]) => double ?? single ?? "",
	);
}
