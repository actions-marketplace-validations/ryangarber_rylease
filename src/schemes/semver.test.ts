import {
	bumpSemver,
	formatSemver,
	isSemver,
	parseSemver,
	semver,
} from "./semver.ts";

describe("parseSemver", () => {
	it("tells semver from other versions", () => {
		expect(isSemver("2026.10.0")).toBe(true);
		expect(isSemver("2026.01.0")).toBe(false);
		expect(isSemver("24.04")).toBe(false);
	});

	it("parses and formats", () => {
		expect(parseSemver("v1.2.3-beta.1+abc")).toEqual({
			major: 1,
			minor: 2,
			patch: 3,
			prerelease: "beta.1",
			build: "abc",
		});
		expect(parseSemver(" 0.0.0 ")).toEqual({ major: 0, minor: 0, patch: 0 });
		expect(formatSemver(parseSemver("1.2.3-rc.0+b.1"))).toBe("1.2.3-rc.0+b.1");
	});

	it.each(["1.2", "01.2.3", "1.2.3-", "1.2.3+", "x1.2.3", ""])(
		"rejects %o",
		(version) => {
			expect(() => parseSemver(version)).toThrow(
				`'${version}' is not a valid semantic version`,
			);
		},
	);
});

describe("bumpSemver", () => {
	it.each([
		["1.2.3", "breaking", "2.0.0"],
		["1.2.3", "feature", "1.3.0"],
		["1.2.3", "fix", "1.2.4"],
		["1.2.3-beta.1+b", "fix", "1.2.4"],
	] as const)("bumps %s by %s to %s", (from, kind, to) => {
		expect(formatSemver(bumpSemver(parseSemver(from), kind))).toBe(to);
	});
});

describe("semver", () => {
	const bump = (
		previous: string | undefined,
		kind: "breaking" | "feature" | "fix",
		options?: Parameters<typeof semver>[0],
	) =>
		semver(options).bump({
			...(previous !== undefined && { previous }),
			kind,
			branch: "main",
			date: new Date(),
		});

	it.each([
		["1.2.3", "breaking", "2.0.0", "bumps major"],
		["1.2.3", "feature", "1.3.0", "bumps minor"],
		["1.2.3", "fix", "1.2.4", "bumps patch"],
		["2.0.0-rc.1", "fix", "2.0.1", "bumps patch"],
		["0.4.2", "breaking", "0.5.0", "bumps minor (pre-1.0)"],
		["0.4.2", "feature", "0.4.3", "bumps patch (pre-1.0)"],
		["0.4.2", "fix", "0.4.3", "bumps patch"],
	] as const)("%s + %s → %s", (previous, kind, version, reason) => {
		expect(bump(previous, kind)).toEqual({ version, reason });
	});

	it("can bump 0.x like any other version", () => {
		expect(bump("0.4.2", "breaking", { shiftPreMajor: false })).toEqual({
			version: "1.0.0",
			reason: "bumps major",
		});
	});

	it("starts from its initial version", () => {
		expect(bump(undefined, "breaking")).toEqual({
			version: "0.1.0",
			reason: "first release",
		});
		expect(bump(undefined, "fix", { initial: "1.0.0" }).version).toBe("1.0.0");
		expect(() => semver({ initial: "1.0" })).toThrow(
			"semver.initial: must be a semantic version",
		);
	});

	it("recognizes, orders and names versions", () => {
		const scheme = semver();
		expect(scheme.traits).toEqual(["version.semver"]);
		// Pre-releases are left to channels.
		expect(scheme.matches("1.2.3")).toBe(true);
		expect(scheme.matches("1.2.3-rc.1")).toBe(false);
		expect(scheme.matches("2026.01.0")).toBe(false);
		expect(scheme.compare("1.10.0", "1.9.0")).toBeGreaterThan(0);
		expect(scheme.compare("1.0.0-rc.1", "1.0.0")).toBeLessThan(0);
		expect(scheme.fields?.("1.2.3-rc.1")).toEqual({
			major: "1",
			minor: "2",
			patch: "3",
			prerelease: "rc.1",
		});
	});
});
