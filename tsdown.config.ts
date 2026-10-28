import { defineConfig } from "tsdown";

export default defineConfig([
	{
		name: "library",
		entry: ["src/index.ts", "src/internal.ts"],
		format: ["esm", "cjs"],
		platform: "node",
		dts: {
			enabled: true,
			sourcemap: true,
		},
		sourcemap: true,
		deps: {
			neverBundle: true,
		},
	},
	{
		// `rylease`: runs @rylease/cli with this package as its engine.
		name: "cli",
		entry: { cli: "src/cli.ts" },
		format: ["esm"],
		platform: "node",
		target: "node24",
		dts: false,
		sourcemap: false,
		clean: false,
		minify: true,
	},
	{
		// The GitHub Action: one self-contained file, committed to the repository.
		name: "action",
		entry: { action: "src/config/action.ts" },
		format: ["esm"],
		platform: "node",
		target: "node24",
		deps: {
			alwaysBundle: ["yaml", "zod"],
			onlyBundle: false,
		},
		dts: false,
		sourcemap: false,
		clean: false,
		minify: true,
	},
]);
