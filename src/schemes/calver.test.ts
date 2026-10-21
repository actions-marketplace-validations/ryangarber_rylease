import type { ReleaseKind } from "../core/types.ts";
import { calver } from "./calver.ts";

const bump = async (
	previous: string | undefined,
	kind: ReleaseKind = "fix",
	options?: Parameters<typeof calver>[0],
) =>
	calver(options).bump({
		...(previous !== undefined && { previous }),
		kind,
		branch: "main",
		date: new Date(),
	});

describe("calver", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-10-20T23:30:00Z"));
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("starts each period from 0, and counts releases within it", async () => {
		expect(await bump("2026.9.4")).toEqual({
			version: "2026.10.0",
			reason: "new period",
		});
		expect(await bump("2026.10.0", "breaking")).toEqual({
			version: "2026.10.1",
			reason: "bumps MICRO",
		});
		expect(await bump(undefined)).toEqual({
			version: "2026.10.0",
			reason: "first release",
		});
	});

	it.each([
		["YYYY.0M.0D", "2026.10.20"],
		["YY.0M", "26.10"],
		["0Y.MM.DD", "26.10.20"],
		["YYYY.WW", "2026.43"],
		["YYYY.0W.MICRO", "2026.43.0"],
	])("formats %s as %s", async (format, version) => {
		expect((await bump(undefined, "fix", { format })).version).toBe(version);
	});

	it("takes weeks from the ISO calendar, with its year", async () => {
		vi.setSystemTime(new Date("2026-12-31T12:00:00Z"));
		expect((await bump(undefined, "fix", { format: "YYYY.0W" })).version).toBe(
			"2026.53",
		);
		vi.setSystemTime(new Date("2027-12-31T12:00:00Z"));
		expect((await bump(undefined, "fix", { format: "YYYY.0W" })).version).toBe(
			"2027.52",
		);
		vi.setSystemTime(new Date("2029-12-31T12:00:00Z"));
		expect((await bump(undefined, "fix", { format: "YY.WW" })).version).toBe(
			"30.1",
		);
	});

	it("takes the date in the time zone", async () => {
		const format = "YYYY.0M.0D";
		expect(
			(await bump(undefined, "fix", { format, timezone: "Asia/Tokyo" }))
				.version,
		).toBe("2026.10.21");
	});

	it("bumps the counter of the kind, resetting the ones after it", async () => {
		const format = "YY.MINOR.MICRO";
		expect((await bump("26.2.5", "fix", { format })).version).toBe("26.2.6");
		expect((await bump("26.2.5", "feature", { format })).version).toBe(
			"26.3.0",
		);
		// No MAJOR counter: the next one down takes it.
		expect((await bump("26.2.5", "breaking", { format })).version).toBe(
			"26.3.0",
		);
		// MINOR alone takes fixes too.
		expect((await bump("26.2", "fix", { format: "YY.MINOR" })).version).toBe(
			"26.3",
		);
		expect(
			(await bump("3.26.1", "breaking", { format: "MAJOR.YY.MICRO" })).version,
		).toBe("4.26.0");
	});

	it("fails to release twice in a period without a counter", async () => {
		await expect(
			bump("2026.10.20", "fix", { format: "YYYY.0M.0D" }),
		).rejects.toThrow(
			"2026.10.20 is already this period's release; add a counter (e.g. MICRO) to 'YYYY.0M.0D' to release more often",
		);
	});

	it("recognizes its own versions, strictly", () => {
		const scheme = calver({ format: "YYYY.0M.MICRO" });
		expect(scheme.name).toBe("calver YYYY.0M.MICRO");
		expect(scheme.matches("2026.01.3")).toBe(true);
		expect(scheme.matches("2026.1.3")).toBe(false);
		expect(scheme.matches("1.4.2")).toBe(false);
		expect(scheme.matches("2026.13.0")).toBe(false);
		expect(scheme.fields?.("2026.01.3")).toEqual({
			YYYY: "2026",
			"0M": "01",
			MICRO: "3",
		});
		expect(scheme.compare("2026.10.0", "2026.09.4")).toBeGreaterThan(0);
	});

	it("makes semantic versions only without zero-padded tokens", () => {
		expect(calver().traits).toEqual(["version.semver"]);
		expect(calver({ format: "YYYY.0M.MICRO" }).traits).toEqual([]);
	});

	it("rejects bad formats and time zones", () => {
		expect(() => calver({ format: "YYYY-0M" })).toThrow(
			"calver.format: must be distinct tokens joined by '.'",
		);
		expect(() => calver({ format: "MAJOR.MICRO" })).toThrow(
			"calver.format: must have a date token",
		);
		expect(() => calver({ format: "YYYY.MICRO.MICRO" })).toThrow(
			"must be distinct tokens",
		);
		expect(() => calver({ timezone: "Mars/Base" })).toThrow(
			"calver.timezone: must be an IANA time zone",
		);
	});
});
