import { isRecord } from "./parse.ts";

/** Whether a workflow runs for an event, and why or why not. */
export interface Triggered {
	fires: boolean;
	reason: string;
}

export interface Event {
	name: string;
	/** Its activity type, e.g. `opened`. */
	type?: string | undefined;
	/** `refs/heads/x` or `refs/tags/x`, for `push`. */
	ref: string;
	/** The base branch, for `pull_request`. */
	baseRef?: string;
	/** For `workflow_run`: the workflow that ran, and on what branch. */
	workflow?: string;
	headBranch?: string;
	/** The files it changed, for `paths` filters. */
	changedFiles: () => Promise<readonly string[]>;
}

/** The activity types that trigger an event when `types` doesn't say. */
const DEFAULT_TYPES: Record<string, readonly string[]> = {
	pull_request: ["opened", "synchronize", "reopened"],
	pull_request_target: ["opened", "synchronize", "reopened"],
};

export async function triggers(
	on: Record<string, unknown>,
	event: Event,
): Promise<Triggered> {
	if (!(event.name in on)) {
		const events = Object.keys(on);
		return {
			fires: false,
			reason: `it doesn't run on ${event.name}, only on ${events.join(", ") || "nothing"}`,
		};
	}
	const filters = isRecord(on[event.name])
		? (on[event.name] as Record<string, unknown>)
		: {};
	const list = (key: string) =>
		filters[key] === undefined ? undefined : [filters[key]].flat().map(String);

	const types = list("types") ?? DEFAULT_TYPES[event.name];
	if (types && event.type !== undefined && !types.includes(event.type)) {
		return {
			fires: false,
			reason: `${event.name} '${event.type}' isn't one of its types: ${types.join(", ")}`,
		};
	}

	const refs = refFilter(event, list);
	if (refs) return refs;

	if (event.name === "workflow_run") {
		const workflows = list("workflows") ?? [];
		if (
			event.workflow !== undefined &&
			!workflows.some((name) => name === event.workflow)
		) {
			return {
				fires: false,
				reason: `it runs after ${workflows.join(", ")}, not ${event.workflow}`,
			};
		}
	}

	if (["push", "pull_request", "pull_request_target"].includes(event.name)) {
		const paths = list("paths");
		const ignored = list("paths-ignore");
		if (paths || ignored) {
			const files = await event.changedFiles();
			const matching = files.filter((file) =>
				paths ? matches(paths, file) : !matches(ignored ?? [], file),
			);
			if (files.length > 0 && matching.length === 0) {
				return {
					fires: false,
					reason: `none of the ${files.length} changed files match its ${paths ? "paths" : "paths-ignore"}`,
				};
			}
		}
	}
	return {
		fires: true,
		reason: `it runs on ${event.name}${event.type ? ` '${event.type}'` : ""}`,
	};
}

function refFilter(
	event: Event,
	list: (key: string) => string[] | undefined,
): Triggered | undefined {
	const branches = list("branches");
	const branchesIgnore = list("branches-ignore");
	const tags = list("tags");
	const tagsIgnore = list("tags-ignore");
	let name: string | undefined;
	let kind: "branch" | "tag";
	if (event.name === "push") {
		kind = event.ref.startsWith("refs/tags/") ? "tag" : "branch";
		name = event.ref.replace(/^refs\/(heads|tags)\//, "");
		const filtersBranches =
			branches !== undefined || branchesIgnore !== undefined;
		const filtersTags = tags !== undefined || tagsIgnore !== undefined;
		if (kind === "tag" && filtersBranches && !filtersTags) {
			return {
				fires: false,
				reason: "it filters branches, so no tag pushes run it",
			};
		}
		if (kind === "branch" && filtersTags && !filtersBranches) {
			return {
				fires: false,
				reason: "it filters tags, so no branch pushes run it",
			};
		}
	} else if (
		event.name === "pull_request" ||
		event.name === "pull_request_target"
	) {
		kind = "branch";
		name = event.baseRef;
	} else if (event.name === "workflow_run") {
		kind = "branch";
		name = event.headBranch;
	} else return undefined;
	if (name === undefined) return undefined;
	const [only, ignore] =
		kind === "branch" ? [branches, branchesIgnore] : [tags, tagsIgnore];
	if (only && !matches(only, name)) {
		return {
			fires: false,
			reason: `${kind} ${name} isn't in its ${kind === "branch" ? "branches" : "tags"}: ${only.join(", ")}`,
		};
	}
	if (ignore && matches(ignore, name)) {
		return {
			fires: false,
			reason: `${kind} ${name} is in its ${kind === "branch" ? "branches" : "tags"}-ignore`,
		};
	}
	return undefined;
}

/** Whether a list of patterns, where later `!` patterns exclude, ends up matching. */
function matches(patterns: readonly string[], value: string): boolean {
	let matched = false;
	for (const pattern of patterns) {
		if (pattern.startsWith("!")) {
			if (matched && globRegex(pattern.slice(1)).test(value)) matched = false;
		} else if (globRegex(pattern).test(value)) matched = true;
	}
	return matched;
}

/**
 * GitHub's filter patterns: `*` within a path segment, `**` across them, `?`
 * and `+` for none-or-one and one-or-more of what's before, and `[...]`.
 */
export function globRegex(pattern: string): RegExp {
	let source = "";
	for (let index = 0; index < pattern.length; index++) {
		const char = pattern[index] ?? "";
		if (char === "\\" && index + 1 < pattern.length) {
			source += escapeChar(pattern[++index] ?? "");
		} else if (char === "*") {
			if (pattern[index + 1] === "*") {
				index++;
				// `**/` also matches nothing, as in `**/x` matching `x`.
				if (pattern[index + 1] === "/") {
					index++;
					source += "(?:.*/)?";
				} else source += ".*";
			} else source += "[^/]*";
		} else if (char === "?" || char === "+") {
			source += char;
		} else if (char === "[") {
			const end = pattern.indexOf("]", index);
			if (end === -1) source += "\\[";
			else {
				source += pattern.slice(index, end + 1);
				index = end;
			}
		} else source += escapeChar(char);
	}
	return new RegExp(`^${source}$`);
}

function escapeChar(char: string): string {
	return char.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}
