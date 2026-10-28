import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		projects: [
			{
				extends: true,
				test: { name: "rylease", include: ["src/**/*.test.ts"] },
			},
			"packages/cli",
		],
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
