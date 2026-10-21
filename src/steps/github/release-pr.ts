import type { Kind } from "../../core/types.ts";

/** The branch prefix of release pull requests, and their label until released. */
export const RELEASE_BRANCH = "rylease/";
export const PENDING_LABEL = "rylease: pending";

/** What a release pull request releases once it merges, by component. */
export interface Manifest {
	components: Record<
		string,
		{
			version: string;
			tag: string;
			kind: Kind;
			previousVersion?: string;
			notes: string;
		}
	>;
}

const MARKER = /<!-- rylease (\{[\s\S]*?\}) -->\s*$/;

/** A pull request's body: each release's notes, then the manifest, hidden. */
export function releaseBody(manifest: Manifest): string {
	const sections = Object.values(manifest.components).map(
		({ tag, notes }) => `## ${tag}\n\n${notes.trim() || "_No notes._"}`,
	);
	return `${sections.join("\n\n")}\n\n<!-- rylease ${JSON.stringify(manifest)} -->\n`;
}

/** The manifest in a pull request's body, if it has a valid one. */
export function readManifest(body: string | null): Manifest | undefined {
	const json = MARKER.exec(body ?? "")?.[1];
	if (json === undefined) return undefined;
	try {
		const manifest = JSON.parse(json) as Manifest;
		return typeof manifest.components === "object" ? manifest : undefined;
	} catch {
		return undefined;
	}
}
