import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		globals: true,
		typecheck: {
			enabled: true,
		},
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: ["src/testing/**", "src/**/*.test-d.ts"],
		},
	},
});
