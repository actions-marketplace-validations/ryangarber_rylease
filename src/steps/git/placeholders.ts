/**
 * Placeholders for what's released as a whole: `{tags}`, every release's
 * tag, and with one component, its own placeholders.
 */
export function releasedPlaceholders(
	components: readonly {
		tag: string;
		placeholders: Readonly<Record<string, string>>;
	}[],
): Record<string, string> {
	const [only] = components;
	return {
		...(components.length === 1 && only ? only.placeholders : {}),
		tags: components.map(({ tag }) => tag).join(", "),
	};
}
