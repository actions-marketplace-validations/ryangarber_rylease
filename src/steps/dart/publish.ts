import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { defineStep } from "../../core/define.ts";
import { z } from "../../core/options.ts";
import { exec } from "../../utils/exec.ts";
import { inComponent } from "../../utils/files.ts";
import {
	pubspecField,
	pubspecVersion,
	setPubspecVersion,
	withoutBuildNumber,
} from "./pubspec.ts";

const PUB_DEV = "https://pub.dev";

/**
 * Publishes the package to pub.dev, or the server in its `publish_to`, after
 * earlier steps wrote the new version to `pubspec.yaml`.
 */
export const dartPublish = defineStep({
	phase: "release",
	name: "dart/publish",
	description:
		"Publishes the component's package to pub.dev, or its `publish_to` server, with `dart` or `flutter pub publish`; components are published dependencies first.",
	needs: ["version.semver"],
	options: {
		path: z
			.string()
			.default(".")
			.describe("The package's directory, relative to the component's."),
		client: z
			.enum(["dart", "flutter"])
			.optional()
			.describe(
				"Defaults to `flutter` for packages that depend on the Flutter SDK, otherwise `dart`.",
			),
		token: z
			.string()
			.optional()
			.describe(
				"Defaults to `PUB_TOKEN`; it's added for the server with `pub token add --env-var PUB_TOKEN`, as `dart-lang/setup-dart` does. Without one, the client's own auth is used.",
			),
	},
	run: async ({ env, component, version, options }) => {
		const { file: dir, relative } = inComponent(env, component, options.path);
		const manifest = posix.join(relative, "pubspec.yaml");
		const text = await readFile(join(dir, "pubspec.yaml"), "utf8");
		const name = pubspecField(text, "name");
		if (!name) throw new Error(`${manifest} has no 'name'`);
		const publishTo = pubspecField(text, "publish_to");
		if (publishTo === "none") {
			throw new Error(
				`${manifest} has 'publish_to: none'; pub won't publish it`,
			);
		}
		const server = publishTo ?? PUB_DEV;
		const client =
			options.client ??
			(/^\s+sdk:[ \t]*["']?flutter\b/m.test(text) ? "flutter" : "dart");
		// What's published, with any build number, e.g. 1.2.0+3; in a dry
		// run, what fs/write-version would have written.
		const current = pubspecVersion(text);
		const written =
			current !== undefined && withoutBuildNumber(current) === version;
		const published = written
			? current
			: current === undefined
				? version
				: setPubspecVersion(text, version, new Map()).version;
		const target = `${name} ${published} to ${server}`;
		const output = { name, version: published, client, server };

		if (env.dryRun) {
			return {
				output: { ...output, published: false },
				reason: `would ${client} pub publish ${target}`,
			};
		}

		// Never publish a version other than the one being released, e.g. when
		// no earlier step wrote it to pubspec.yaml.
		if (current === undefined) throw new Error(`${manifest} has no 'version'`);
		if (!written) {
			throw new Error(
				`${manifest} is at ${current}, not ${version}; write it first (fs/write-version, with format: dart)`,
			);
		}

		const token = options.token ?? process.env.PUB_TOKEN;
		const childEnv = token ? { ...process.env, PUB_TOKEN: token } : process.env;
		if (token) {
			// Only the variable's name is stored, never the token.
			await exec(
				client,
				["pub", "token", "add", server, "--env-var", "PUB_TOKEN"],
				{ cwd: dir, env: childEnv },
			);
		}
		await exec(client, ["pub", "publish", "--force"], {
			cwd: dir,
			env: childEnv,
		});
		return {
			output: { ...output, published: true },
			reason: `published ${target}`,
		};
	},
});
