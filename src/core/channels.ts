import { fill } from "../utils/template.ts";
import { OptionsError } from "./options.ts";
import type { Scheme } from "./scheme.ts";

/**
 * A release channel: versions that wrap the scheme's own in a format with a
 * counter, e.g. `2.0.0-next.1`. A `prerelease` comes before the version it
 * leads up to; a `build` comes after the version it numbers builds of.
 */
export interface Channel {
	/** Branches that release on this channel, as globs, e.g. `beta/*`. */
	branches?: readonly string[];
	/** Defaults to `prerelease`. */
	type?: ChannelType;
	/**
	 * How its versions are written: `{version}` is the target version, `{n}`
	 * the counter and `{channel}` the channel's name. Defaults to the
	 * scheme's, or `{version}-{channel}.{n}` for a prerelease and
	 * `{version}+{channel}.{n}` for a build.
	 */
	format?: string;
}

export type ChannelType = "prerelease" | "build";

/** The channel a run releases on. */
export interface RunChannel {
	name: string;
	type: ChannelType;
}

/** A channel, with its format worked out for a scheme. */
export interface ResolvedChannel extends RunChannel {
	format: string;
}

const DEFAULT_FORMATS: Record<ChannelType, string> = {
	prerelease: "{version}-{channel}.{n}",
	build: "{version}+{channel}.{n}",
};

/** Checks channels, so a typo fails before anything runs. */
export function checkChannels(
	channels: Readonly<Record<string, Channel>>,
): void {
	const issues: string[] = [];
	for (const [name, channel] of Object.entries(channels)) {
		const at = `channels.${name}`;
		if (!/^[0-9A-Za-z-]+$/.test(name)) {
			issues.push(`${at}: names may only have letters, digits and '-'`);
		}
		if (
			channel.type !== undefined &&
			channel.type !== "prerelease" &&
			channel.type !== "build"
		) {
			issues.push(`${at}.type: expected prerelease or build`);
		}
		const format = channel.format;
		if (format !== undefined) {
			for (const name of ["{version}", "{n}"]) {
				if (!format.includes(name)) {
					issues.push(`${at}.format: '${format}' has no ${name} placeholder`);
				}
			}
			const unknown = [...format.matchAll(/\{(\w+)\}/g)]
				.map(([, name]) => name)
				.find((name) => !["version", "n", "channel"].includes(name ?? ""));
			if (unknown) {
				issues.push(
					`${at}.format: unknown placeholder {${unknown}}; use {version}, {n} or {channel}`,
				);
			}
		}
	}
	if (issues.length > 0) throw new OptionsError(issues);
}

/**
 * The channel a run releases on: the one asked for, or the first whose
 * branches match; none means a stable release.
 */
export function selectChannel(
	channels: Readonly<Record<string, Channel>>,
	branch: string,
	asked: string | undefined,
): RunChannel | undefined {
	if (asked !== undefined && asked !== "") {
		const channel = channels[asked];
		if (!channel) {
			const known = Object.keys(channels);
			throw new OptionsError([
				`channel: '${asked}' isn't a channel${known.length > 0 ? `; use ${known.join(", ")}` : "; define it in channels"}`,
			]);
		}
		return { name: asked, type: channel.type ?? "prerelease" };
	}
	for (const [name, channel] of Object.entries(channels)) {
		if (channel.branches?.some((pattern) => matchesGlob(branch, pattern))) {
			return { name, type: channel.type ?? "prerelease" };
		}
	}
	return undefined;
}

/** Every channel, with its format for the scheme. */
export function resolveChannels(
	channels: Readonly<Record<string, Channel>>,
	scheme: Scheme,
): ResolvedChannel[] {
	return Object.entries(channels).map(([name, channel]) => {
		const type = channel.type ?? "prerelease";
		return {
			name,
			type,
			format: channel.format ?? scheme.formats?.[type] ?? DEFAULT_FORMATS[type],
		};
	});
}

/** What a version is, as far as the scheme and channels can tell. */
export type Classified =
	| { type: "stable"; target: string }
	| { type: ChannelType; channel: string; target: string; n: number }
	| { type: "foreign" };

/**
 * Classifies a version: on one of the channels (`2.0.0-next.3`), stable in
 * the scheme (`2.0.0`), or neither.
 */
export function classify(
	version: string,
	scheme: Scheme,
	channels: readonly ResolvedChannel[],
): Classified {
	for (const channel of channels) {
		const match = channelPattern(channel).exec(version);
		const target = match?.groups?.version;
		const n = match?.groups?.n;
		if (target !== undefined && n !== undefined && scheme.matches(target)) {
			return {
				type: channel.type,
				channel: channel.name,
				target,
				n: Number(n),
			};
		}
	}
	return scheme.matches(version)
		? { type: "stable", target: version }
		: { type: "foreign" };
}

/** A version on a channel. */
export function channelVersion(
	channel: ResolvedChannel,
	target: string,
	n: number,
): string {
	return fill(channel.format, {
		version: target,
		channel: channel.name,
		n: String(n),
	});
}

const RANK = { prerelease: -1, stable: 0, build: 1 } as const;

/**
 * Orders classified versions: by target in the scheme, then a prerelease
 * before the stable version before a build, then by counter.
 */
export function compareClassified(
	a: Classified,
	b: Classified,
	scheme: Scheme,
): number {
	if (a.type === "foreign" || b.type === "foreign") return 0;
	const order = scheme.compare(a.target, b.target);
	if (order !== 0) return order;
	if (a.type !== b.type) return RANK[a.type] - RANK[b.type];
	return a.type === "stable" || b.type === "stable" ? 0 : a.n - b.n;
}

function channelPattern(channel: ResolvedChannel): RegExp {
	const source = channel.format
		.split(/(\{\w+\})/)
		.map((part) => {
			if (part === "{version}") return "(?<version>.+?)";
			if (part === "{n}") return "(?<n>\\d+)";
			const literal = part === "{channel}" ? channel.name : part;
			return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		})
		.join("");
	return new RegExp(`^${source}$`);
}

/** `*` matches within a path segment, `**` across them. */
export function matchesGlob(text: string, pattern: string): boolean {
	const source = pattern
		.split(/(\*\*|\*)/)
		.map((part) =>
			part === "**"
				? ".*"
				: part === "*"
					? "[^/]*"
					: part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
		)
		.join("");
	return new RegExp(`^${source}$`).test(text);
}
