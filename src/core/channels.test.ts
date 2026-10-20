import { calver } from "../schemes/calver.ts";
import { semver } from "../schemes/semver.ts";
import {
	channelVersion,
	checkChannels,
	classify,
	compareClassified,
	matchesGlob,
	resolveChannels,
	selectChannel,
} from "./channels.ts";
import { defineScheme } from "./scheme.ts";

const channels = {
	next: { branches: ["next"] },
	beta: { branches: ["beta/*"], format: "{version}-beta.{n}" },
	nightly: { type: "build" as const },
};

describe("selectChannel", () => {
	it("takes the channel asked for, or the first whose branches match", () => {
		expect(selectChannel(channels, "main", undefined)).toBeUndefined();
		expect(selectChannel(channels, "next", undefined)).toEqual({
			name: "next",
			type: "prerelease",
		});
		expect(selectChannel(channels, "beta/2", undefined)?.name).toBe("beta");
		expect(selectChannel(channels, "main", "nightly")).toEqual({
			name: "nightly",
			type: "build",
		});
		expect(() => selectChannel(channels, "main", "rc")).toThrow(
			"channel: 'rc' isn't a channel; use next, beta, nightly",
		);
	});

	it("matches branches by glob", () => {
		expect(matchesGlob("release/1.x", "release/*")).toBe(true);
		expect(matchesGlob("release/a/b", "release/*")).toBe(false);
		expect(matchesGlob("release/a/b", "release/**")).toBe(true);
	});
});

describe("checkChannels", () => {
	it("rejects bad names, types and formats", () => {
		expect(() =>
			checkChannels({
				"rc 1": {},
				x: { type: "nightly" as never },
				y: { format: "{version}-y" },
				z: { format: "{version}.{n}.{build}" },
			}),
		).toThrow(
			[
				"channels.rc 1: names may only have letters, digits and '-'",
				"channels.x.type: expected prerelease or build",
				"channels.y.format: '{version}-y' has no {n} placeholder",
				"channels.z.format: unknown placeholder {build}; use {version}, {n} or {channel}",
			].join("\n"),
		);
	});
});

describe("classify and compare", () => {
	const resolved = resolveChannels(channels, semver());

	it("tells channel versions from stable and foreign ones", () => {
		expect(classify("2.0.0-next.3", semver(), resolved)).toEqual({
			type: "prerelease",
			channel: "next",
			target: "2.0.0",
			n: 3,
		});
		expect(classify("1.4.0+nightly.12", semver(), resolved)).toEqual({
			type: "build",
			channel: "nightly",
			target: "1.4.0",
			n: 12,
		});
		expect(classify("1.4.0", semver(), resolved)).toEqual({
			type: "stable",
			target: "1.4.0",
		});
		expect(classify("1.4.0-alpha.1", semver(), resolved)).toEqual({
			type: "foreign",
		});
	});

	it("orders a prerelease before its target, and a build after", () => {
		const order = [
			"1.4.0",
			"1.4.0+nightly.1",
			"1.4.0+nightly.2",
			"2.0.0-beta.1",
			"2.0.0-next.1",
			"2.0.0-next.2",
			"2.0.0",
		];
		const sorted = [...order]
			.reverse()
			.sort((a, b) =>
				compareClassified(
					classify(a, semver(), resolved),
					classify(b, semver(), resolved),
					semver(),
				),
			);
		// beta and next are both prereleases of 2.0.0: only their counters differ.
		expect(sorted.filter((v) => !v.includes("beta"))).toEqual(
			order.filter((v) => !v.includes("beta")),
		);
	});

	it("works with any scheme and format", () => {
		const scheme = calver();
		const own = resolveChannels(channels, scheme);
		expect(channelVersion(own[0] as never, "2026.10.0", 1)).toBe(
			"2026.10.0-next.1",
		);
		expect(classify("2026.10.0-next.1", scheme, own)).toMatchObject({
			channel: "next",
			target: "2026.10.0",
		});
		const python = defineScheme({
			name: "pep440",
			create: () => ({
				...semver(),
				name: "pep440",
				formats: { prerelease: "{version}rc{n}", build: "{version}.post{n}" },
			}),
		})();
		const pep = resolveChannels({ rc: {}, post: { type: "build" } }, python);
		expect(pep.map(({ format }) => format)).toEqual([
			"{version}rc{n}",
			"{version}.post{n}",
		]);
		expect(channelVersion(pep[0] as never, "2.0.0", 1)).toBe("2.0.0rc1");
		expect(classify("2.0.0.post3", python, pep)).toMatchObject({
			type: "build",
			n: 3,
		});
	});
});
