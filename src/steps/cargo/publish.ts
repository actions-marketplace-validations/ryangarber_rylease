import { readFile } from "node:fs/promises";
import { dirname, join, posix, relative } from "node:path";
import { defineStep } from "../../core/define.ts";
import { z } from "../../core/options.ts";
import { exec } from "../../utils/exec.ts";
import { inComponent } from "../../utils/files.ts";
import { tomlKey, tomlValue } from "../../utils/toml.ts";

const packageName = tomlKey(["package"], "name");
const packageVersion = tomlKey(["package"], "version");
const workspaceVersion = tomlKey(["workspace.package"], "version");

/**
 * The version a crate's manifest gives it, and where: its own, or the
 * workspace's it inherits with `version.workspace = true`.
 */
async function crateVersion(
	cwd: string,
	dir: string,
	text: string,
): Promise<{ version: string; manifest: string } | undefined> {
	const own = packageVersion.read(text);
	const manifest = (path: string) =>
		relative(cwd, join(path, "Cargo.toml")).replaceAll("\\", "/");
	if (own !== undefined) return { version: own, manifest: manifest(dir) };
	// The workspace's may be in the crate's own manifest, at the root.
	for (let current = dir; ; current = dirname(current)) {
		const root = await readFile(join(current, "Cargo.toml"), "utf8").catch(
			() => undefined,
		);
		const version = root && workspaceVersion.read(root);
		if (version) return { version, manifest: manifest(current) };
		if (dirname(current) === current || relative(cwd, current) === "") {
			return undefined;
		}
	}
}

/**
 * Publishes the crate to crates.io, or another registry, after earlier steps
 * wrote the new version to `Cargo.toml`. Cargo verifies the crate builds
 * first, and waits for it to be available, so dependents publish after it.
 */
export const cargoPublish = defineStep({
	phase: "release",
	name: "cargo/publish",
	description:
		"Publishes the component's crate to crates.io, or another registry, with `cargo publish`; components are published dependencies first.",
	needs: ["version.semver"],
	options: {
		path: z
			.string()
			.default(".")
			.describe("The crate's directory, relative to the component's."),
		registry: z
			.string()
			.optional()
			.describe(
				"The name of a registry in Cargo's config; defaults to crates.io.",
			),
		token: z
			.string()
			.optional()
			.describe(
				"Defaults to `CARGO_REGISTRY_TOKEN`, or `CARGO_REGISTRIES_<NAME>_TOKEN` with a `registry`, which Cargo reads itself; without one, Cargo's own auth is used.",
			),
	},
	run: async ({ env, component, version, options }) => {
		const { file: dir, relative: path } = inComponent(
			env,
			component,
			options.path,
		);
		const manifest = posix.join(path, "Cargo.toml");
		const text = await readFile(join(dir, "Cargo.toml"), "utf8");
		const name = packageName.read(text);
		if (!name) throw new Error(`${manifest} has no [package] 'name'`);
		if (tomlValue(text, "package", "publish") === "false") {
			throw new Error(
				`${manifest} has 'publish = false'; cargo won't publish it`,
			);
		}
		const registry = options.registry ?? "crates.io";
		const target = `${name}@${version} to ${registry}`;
		const output = { name, version, registry };

		if (env.dryRun) {
			return {
				output: { ...output, published: false },
				reason: `would cargo publish ${target}`,
			};
		}

		// Never publish a version other than the one being released, e.g. when
		// no earlier step wrote it to Cargo.toml.
		const current = await crateVersion(env.cwd, dir, text);
		if (current === undefined) {
			throw new Error(`${manifest} has no [package] 'version'`);
		}
		if (current.version !== version) {
			throw new Error(
				`${current.manifest} is at ${current.version}, not ${version}; write it first (fs/write-version, with format: cargo)`,
			);
		}

		const args = ["publish"];
		if (options.registry) args.push("--registry", options.registry);
		const variable = options.registry
			? `CARGO_REGISTRIES_${options.registry.toUpperCase().replaceAll("-", "_")}_TOKEN`
			: "CARGO_REGISTRY_TOKEN";
		await exec("cargo", args, {
			cwd: dir,
			env: options.token
				? { ...process.env, [variable]: options.token }
				: process.env,
		});
		return {
			output: { ...output, published: true },
			reason: `published ${target}`,
		};
	},
});
