import type { ReleaseKind } from "../types.ts";

export interface SemVer {
	major: number;
	minor: number;
	patch: number;
	prerelease?: string;
	build?: string;
}

const PATTERN =
	/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

export function parseVersion(version: string): SemVer {
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

export function formatVersion(version: SemVer): string {
	let text = `${version.major}.${version.minor}.${version.patch}`;
	if (version.prerelease !== undefined) text += `-${version.prerelease}`;
	if (version.build !== undefined) text += `+${version.build}`;
	return text;
}

/** Bumps a version; pre-release and build metadata are dropped. */
export function bumpVersion(version: SemVer, kind: ReleaseKind): SemVer {
	const { major, minor, patch } = version;
	switch (kind) {
		case "major":
			return { major: major + 1, minor: 0, patch: 0 };
		case "minor":
			return { major, minor: minor + 1, patch: 0 };
		case "patch":
			return { major, minor, patch: patch + 1 };
	}
}

/** Orders versions by precedence; build metadata is ignored. */
export function compareVersions(a: SemVer, b: SemVer): number {
	return (
		a.major - b.major ||
		a.minor - b.minor ||
		a.patch - b.patch ||
		comparePrerelease(a.prerelease, b.prerelease)
	);
}

function comparePrerelease(a?: string, b?: string): number {
	if (a === b) return 0;
	// A version without a pre-release ranks above one with it.
	if (a === undefined) return 1;
	if (b === undefined) return -1;
	const left = a.split(".");
	const right = b.split(".");
	for (let i = 0; i < Math.max(left.length, right.length); i++) {
		const x = left[i];
		const y = right[i];
		if (x === undefined) return -1;
		if (y === undefined) return 1;
		const numeric = /^\d+$/.test(x) && /^\d+$/.test(y);
		const order = numeric ? Number(x) - Number(y) : x < y ? -1 : x > y ? 1 : 0;
		if (order !== 0) return order;
	}
	return 0;
}
