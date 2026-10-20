import { z } from "../core/options.ts";
import type { Environment } from "../core/types.ts";

/** The `channels` option of steps that a channel's releases skip by default. */
export const channelsOption = z
	.boolean()
	.default(false)
	.describe(
		"Also run for releases on a channel, e.g. prereleases; by default only stable releases do.",
	);

/**
 * For a step that leaves channel releases to the stable release, e.g. so a
 * prerelease doesn't take the changelog's entries: its output when it's
 * skipped, or `undefined` when it runs.
 */
export function skipOnChannel(
	env: Environment,
	channels: boolean,
	what: string,
): { output: null; reason: string } | undefined {
	if (!env.channel || channels) return undefined;
	return {
		output: null,
		reason: `left ${what} for the stable release, as this is on ${env.channel.name}`,
	};
}
