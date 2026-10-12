import { defineConfig } from "tsdown";

export default defineConfig([
	{
		name: "library",
		entry: ["src/index.ts"],
		format: ["esm", "cjs"],
		platform: "node",
		dts: {
			enabled: true,
			sourcemap: true,
		},
		sourcemap: true,
		skipNodeModulesBundle: true,
	},
	{
		// The GitHub Action: one self-contained file, committed to the repository.
		name: "action",
		entry: { action: "src/action.ts" },
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
