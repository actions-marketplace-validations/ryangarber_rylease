/**
 * A version as most schemes write it: dot-separated numbers, then an optional
 * `-pre.release` and `+build`. Semver (`1.2.3-rc.1`), CalVer (`2026.01.3`),
 * `24.04` and `1.2.3.4` all fit; nothing here requires a particular scheme.
 */
export interface Version {
	/** The numbers, as written, e.g. `["2026", "01", "3"]`. */
	release: string[];
	prerelease?: string;
	build?: string;
}

const PATTERN =
	/^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

/** Parses a version, or returns `undefined` if it isn't one, e.g. `next`. */
export function parseVersion(version: string): Version | undefined {
	const match = PATTERN.exec(version.trim());
	if (!match) return undefined;
	const [, release = "", prerelease, build] = match;
	return {
		release: release.split("."),
		...(prerelease !== undefined && { prerelease }),
		...(build !== undefined && { build }),
	};
}

/**
 * Orders versions by precedence: number by number, a missing number counting
 * as 0 (`1.2` = `1.2.0`), then by pre-release as in semver. Build metadata is
 * ignored.
 */
export function compareVersions(a: Version, b: Version): number {
	for (let i = 0; i < Math.max(a.release.length, b.release.length); i++) {
		const order = compareNumbers(a.release[i] ?? "0", b.release[i] ?? "0");
		if (order !== 0) return order;
	}
	return comparePrerelease(a.prerelease, b.prerelease);
}

/** The index of the first number that differs, or `undefined` if none does. */
export function firstDifference(a: Version, b: Version): number | undefined {
	for (let i = 0; i < Math.max(a.release.length, b.release.length); i++) {
		if (compareNumbers(a.release[i] ?? "0", b.release[i] ?? "0") !== 0) {
			return i;
		}
	}
	return undefined;
}

/** Compares digit strings by value, however long, ignoring leading zeros. */
function compareNumbers(a: string, b: string): number {
	const x = BigInt(a);
	const y = BigInt(b);
	return x < y ? -1 : x > y ? 1 : 0;
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
		const order = numeric ? compareNumbers(x, y) : x < y ? -1 : x > y ? 1 : 0;
		if (order !== 0) return order;
	}
	return 0;
}
