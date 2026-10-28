import { defineConfig } from "tsdown";

export default defineConfig({
	entry: { index: "src/index.ts", bin: "src/bin.ts" },
	format: ["esm"],
	platform: "node",
	target: "node24",
	// rylease stays external: it's resolved at runtime, to the engine in use,
	// and typed by its build, not by its source as tsconfig.json has it.
	tsconfig: "tsconfig.build.json",
	dts: {
		enabled: true,
	},
	sourcemap: false,
});
