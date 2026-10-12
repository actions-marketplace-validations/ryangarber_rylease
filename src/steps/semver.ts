import { defineStep } from "../define.ts";
import { z } from "../options.ts";
import { bumpVersion, formatVersion, parseVersion } from "../utils/semver.ts";

/**
 * `MAJOR.minor.patch`. Before 1.0.0, bumps shift down a level by default
 * (`0.MAJOR.minorOrPatch`): a major change bumps the minor number and anything
 * else bumps the patch number.
 */
export const semver = defineStep({
	type: "release-version",
	name: "semver",
	description:
		"Bumps the previous version by the kind: `MAJOR.minor.patch`, or `0.MAJOR.minorOrPatch` before 1.0.0.",
	options: {
		shiftPreMajor: z
			.boolean()
			.default(true)
			.describe(
				"Before 1.0.0, bump major changes as minor and minor changes as patch.",
			),
	},
	run: ({ previousVersion, kind, options }) => {
		const previous = parseVersion(previousVersion);
		if (previous.major === 0 && options.shiftPreMajor) {
			const effective = kind === "major" ? "minor" : "patch";
			return {
				version: formatVersion(bumpVersion(previous, effective)),
				reason: `'${kind}' from ${previousVersion} (pre-1.0: bumps ${effective})`,
			};
		}
		return {
			version: formatVersion(bumpVersion(previous, kind)),
			reason: `'${kind}' from ${previousVersion}`,
		};
	},
});
