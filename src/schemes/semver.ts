import { z } from "../core/options.ts";
import { defineScheme } from "../core/scheme.ts";
import type { ReleaseKind } from "../core/types.ts";
import {
	compareVersions,
	parseVersion,
	type Version,
} from "../utils/version.ts";

/** A strict semantic version. */
export interface Semver {
	major: number;
	minor: number;
	patch: number;
	prerelease?: string;
	build?: string;
}

const PATTERN =
	/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

/** Whether a version is valid semver: `MAJOR.MINOR.PATCH`, without leading zeros. */
export function isSemver(version: string): boolean {
	return PATTERN.test(version.trim());
}

/**
 * Whether a version is a stable semantic version: one without a pre-release
 * part, which the scheme leaves to channels.
 */
function isStable(version: string): boolean {
	const match = PATTERN.exec(version.trim());
	return match !== null && match[4] === undefined;
}

export function parseSemver(version: string): Semver {
	const match = PATTERN.exec(version.trim());
	if (!match) throw new Error(`'${version}' is not a valid semantic version`);
	const [, major, minor, patch, prerelease, build] = match;
	return {
		major: Number(major),
		minor: Number(minor),
		patch: Number(patch),
		...(prerelease !== undefined && { prerelease }),
		...(build !== undefined && { build }),
	};
}

export function formatSemver(version: Semver): string {
	let text = `${version.major}.${version.minor}.${version.patch}`;
	if (version.prerelease !== undefined) text += `-${version.prerelease}`;
	if (version.build !== undefined) text += `+${version.build}`;
	return text;
}

/** Bumps a version: `breaking` → major, `feature` → minor, `fix` → patch. */
export function bumpSemver(version: Semver, kind: ReleaseKind): Semver {
	const { major, minor, patch } = version;
	switch (kind) {
		case "breaking":
			return { major: major + 1, minor: 0, patch: 0 };
		case "feature":
			return { major, minor: minor + 1, patch: 0 };
		case "fix":
			return { major, minor, patch: patch + 1 };
	}
}

const POSITION = { breaking: "major", feature: "minor", fix: "patch" } as const;

/**
 * `MAJOR.minor.patch`: breaking changes bump the major number, features the
 * minor and fixes the patch. Before 1.0.0, bumps shift down a level by
 * default (`0.MAJOR.minorOrPatch`).
 */
export const semver = defineScheme({
	name: "semver",
	description:
		"`MAJOR.minor.patch` by the kind: breaking, feature or fix; `0.MAJOR.minorOrPatch` before 1.0.0.",
	options: {
		shiftPreMajor: z
			.boolean()
			.default(true)
			.describe(
				"Before 1.0.0, bump breaking changes as minor and features as patch.",
			),
		initial: z
			.string()
			.default("0.1.0")
			.refine(isSemver, "must be a semantic version, e.g. 1.0.0")
			.describe("The first version, when there's no previous one."),
	},
	create: (options) => ({
		name: "semver",
		traits: ["version.semver"],
		matches: isStable,
		compare: (a, b) =>
			compareVersions(parseVersion(a) as Version, parseVersion(b) as Version),
		bump: ({ previous, kind }) => {
			if (previous === undefined) {
				return { version: options.initial, reason: `first release` };
			}
			const parsed = parseSemver(previous);
			const shifted =
				parsed.major === 0 && options.shiftPreMajor
					? kind === "breaking"
						? "feature"
						: "fix"
					: kind;
			return {
				version: formatSemver(bumpSemver(parsed, shifted)),
				reason:
					shifted === kind
						? `bumps ${POSITION[kind]}`
						: `bumps ${POSITION[shifted]} (pre-1.0)`,
			};
		},
		fields: (version) => {
			const { major, minor, patch, prerelease } = parseSemver(version);
			return {
				major: String(major),
				minor: String(minor),
				patch: String(patch),
				...(prerelease !== undefined && { prerelease }),
			};
		},
	}),
});
