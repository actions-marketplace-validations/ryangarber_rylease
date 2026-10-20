import { z } from "../core/options.ts";
import { defineScheme } from "../core/scheme.ts";
import type { ReleaseKind } from "../core/types.ts";
import {
	compareVersions,
	parseVersion,
	type Version,
} from "../utils/version.ts";

/** The date tokens of calver.org, by what they're made from. */
const DATES = {
	YYYY: (date: Parts) => String(date.year),
	YY: (date: Parts) => String(date.year - 2000),
	"0Y": (date: Parts) => String(date.year - 2000).padStart(2, "0"),
	MM: (date: Parts) => String(date.month),
	"0M": (date: Parts) => String(date.month).padStart(2, "0"),
	WW: (date: Parts) => String(date.week),
	"0W": (date: Parts) => String(date.week).padStart(2, "0"),
	DD: (date: Parts) => String(date.day),
	"0D": (date: Parts) => String(date.day).padStart(2, "0"),
} as const;

/** Counters, from the kind each one is bumped for. */
const COUNTERS = { MAJOR: "breaking", MINOR: "feature", MICRO: "fix" } as const;

const RANK: Record<ReleaseKind, number> = { fix: 0, feature: 1, breaking: 2 };

type DateToken = keyof typeof DATES;
type Counter = keyof typeof COUNTERS;
type Token = DateToken | Counter;

const TOKENS = [...Object.keys(DATES), ...Object.keys(COUNTERS)];

interface Parts {
	year: number;
	month: number;
	day: number;
	week: number;
}

/**
 * Calendar versioning, as on calver.org: the format's date tokens come from
 * the release date, and its counters (`MAJOR`, `MINOR`, `MICRO`) number the
 * releases within the same period. A counter is bumped by the kind it stands
 * for (`breaking`, `feature`, `fix`), or by a higher kind when the format has
 * no counter for that; the counters after it start again from 0, as do all of
 * them in a new period.
 */
export const calver = defineScheme({
	name: "calver",
	description:
		"Dates the version, as on calver.org, e.g. `YYYY.MM.MICRO` → `2026.10.0`; a counter numbers releases in the same period, bumped by the kind.",
	options: {
		format: z
			.string()
			.default("YYYY.MM.MICRO")
			.refine(
				(format) =>
					format.split(".").every((token) => TOKENS.includes(token)) &&
					new Set(format.split(".")).size === format.split(".").length,
				`must be distinct tokens joined by '.', of ${TOKENS.join(", ")}`,
			)
			.refine(
				(format) => format.split(".").some((token) => token in DATES),
				"must have a date token, e.g. YYYY",
			)
			.describe(
				"Tokens joined by `.`: `YYYY`, `YY`, `0Y`, `MM`, `0M`, `WW`, `0W`, `DD`, `0D` (ISO 8601 weeks, with the ISO year), and the counters `MAJOR`, `MINOR`, `MICRO`. Zero-padded tokens (`0M` …) aren't valid semver, which npm needs.",
			),
		timezone: z
			.string()
			.default("UTC")
			.refine(isTimezone, "must be an IANA time zone, e.g. Europe/Berlin")
			.describe("Where the release date is taken, e.g. `America/New_York`."),
	},
	create: (options) => {
		const format = options.format.split(".") as Token[];
		const matches = (version: string) => {
			const parts = version.trim().split(".");
			return (
				parts.length === format.length &&
				parts.every((part, i) => SHAPES[format[i] as Token].test(part))
			);
		};
		const padded = format.some((token) => token.startsWith("0"));
		return {
			name: `calver ${options.format}`,
			traits: padded ? [] : ["version.semver"],
			matches,
			compare: (a, b) =>
				compareVersions(parseVersion(a) as Version, parseVersion(b) as Version),
			bump: ({ previous, kind, date: now }) => {
				const date = dateParts(now, options.timezone, format);
				// The previous version's numbers, by token.
				const before = previous?.split(".").map(Number);
				const samePeriod =
					before !== undefined &&
					format.every(
						(token, i) =>
							!(token in DATES) ||
							Number(DATES[token as DateToken](date)) === before[i],
					);
				const counters = format.filter((token): token is Counter =>
					Object.hasOwn(COUNTERS, token),
				);
				const bumped = samePeriod ? bumpedCounter(counters, kind) : undefined;
				if (samePeriod && bumped === undefined) {
					throw new Error(
						`${previous} is already this period's release; add a counter (e.g. MICRO) to '${options.format}' to release more often`,
					);
				}
				const values = format.map((token, i) => {
					if (token in DATES) return DATES[token as DateToken](date);
					if (!samePeriod || bumped === undefined) return "0";
					const index = format.indexOf(bumped);
					if (i < index) return String(before?.[i]);
					return i === index ? String((before?.[i] ?? 0) + 1) : "0";
				});
				return {
					version: values.join("."),
					reason:
						previous === undefined
							? "first release"
							: samePeriod
								? `bumps ${bumped}`
								: "new period",
				};
			},
			fields: (version) =>
				Object.fromEntries(
					format.map((token, i) => [token, version.split(".")[i] ?? ""]),
				),
		};
	},
});

/** What each token looks like in a version. */
const SHAPES: Record<Token, RegExp> = {
	YYYY: /^[1-9]\d{3}$/,
	YY: /^(0|[1-9]\d*)$/,
	"0Y": /^\d{2,}$/,
	MM: /^([1-9]|1[0-2])$/,
	"0M": /^(0[1-9]|1[0-2])$/,
	WW: /^([1-9]|[1-4]\d|5[0-3])$/,
	"0W": /^(0[1-9]|[1-4]\d|5[0-3])$/,
	DD: /^([1-9]|[12]\d|3[01])$/,
	"0D": /^(0[1-9]|[12]\d|3[01])$/,
	MAJOR: /^(0|[1-9]\d*)$/,
	MINOR: /^(0|[1-9]\d*)$/,
	MICRO: /^(0|[1-9]\d*)$/,
};

/**
 * The counter a kind bumps: its own, or the nearest one below it, or else the
 * lowest the format has (e.g. `MINOR` alone takes fixes too).
 */
function bumpedCounter(
	counters: readonly Counter[],
	kind: ReleaseKind,
): Counter | undefined {
	const ranked = [...counters].sort(
		(a, b) => RANK[COUNTERS[b]] - RANK[COUNTERS[a]],
	);
	return (
		ranked.find((counter) => RANK[COUNTERS[counter]] <= RANK[kind]) ??
		ranked.at(-1)
	);
}

function dateParts(
	now: Date,
	timezone: string,
	format: readonly Token[],
): Parts {
	const fields = Object.fromEntries(
		new Intl.DateTimeFormat("en-US", {
			timeZone: timezone,
			year: "numeric",
			month: "numeric",
			day: "numeric",
		})
			.formatToParts(now)
			.map(({ type, value }) => [type, Number(value)]),
	) as { year: number; month: number; day: number };
	const iso = isoWeek(fields.year, fields.month, fields.day);
	// With weeks, the year is the ISO year, so the last days of December can
	// belong to week 1 of the next.
	const weekly = format.includes("WW") || format.includes("0W");
	return { ...fields, year: weekly ? iso.year : fields.year, week: iso.week };
}

/** The ISO 8601 week of a date, and the year that week belongs to. */
function isoWeek(
	year: number,
	month: number,
	day: number,
): { year: number; week: number } {
	const date = new Date(Date.UTC(year, month - 1, day));
	// The week's Thursday decides its year; week 1 is the one with January 4th.
	date.setUTCDate(date.getUTCDate() + 3 - weekday(date));
	const weekYear = date.getUTCFullYear();
	const first = new Date(Date.UTC(weekYear, 0, 4));
	first.setUTCDate(first.getUTCDate() + 3 - weekday(first));
	const weeks = (date.getTime() - first.getTime()) / (7 * 86_400_000);
	return { year: weekYear, week: 1 + Math.round(weeks) };
}

/** Monday is 0. */
function weekday(date: Date): number {
	return (date.getUTCDay() + 6) % 7;
}

function isTimezone(timezone: string): boolean {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: timezone });
		return true;
	} catch {
		return false;
	}
}
