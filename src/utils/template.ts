const PLACEHOLDER = /\{(\w+)\}/g;

/** Replaces `{name}` placeholders, e.g. `v{version}` → `v1.2.3`. */
export function fill(
	template: string,
	values: Readonly<Record<string, string>>,
): string {
	return template.replace(PLACEHOLDER, (_, name: string) => {
		const value = values[name];
		if (value === undefined) {
			const known = Object.keys(values).map((key) => `{${key}}`);
			throw new Error(
				`unknown placeholder {${name}} in '${template}'; use ${known.join(" or ")}`,
			);
		}
		return value;
	});
}

/**
 * Matches text produced by `fill(template, { [name]: ... })`, capturing the
 * value of `name`, e.g. `v{version}` → `/^v(.+)$/`.
 */
export function templatePattern(template: string, name: string): RegExp {
	let found = false;
	const source = template
		.split(PLACEHOLDER)
		.map((part, index) => {
			// Odd indices are placeholder names.
			if (index % 2 === 0) return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			if (part !== name) {
				throw new Error(`unknown placeholder {${part}} in '${template}'`);
			}
			found = true;
			return "(.+)";
		})
		.join("");
	if (!found) throw new Error(`'${template}' has no {${name}} placeholder`);
	return new RegExp(`^${source}$`);
}
