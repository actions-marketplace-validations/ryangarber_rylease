import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Tests run against rylease's source, not its build.
const source = (path: string) =>
	fileURLToPath(new URL(`../../src/${path}`, import.meta.url));

export default defineConfig({
	resolve: {
		alias: [
			{ find: /^rylease$/, replacement: source("index.ts") },
			{ find: /^rylease\/internal$/, replacement: source("internal.ts") },
		],
	},
	test: {
		name: "@rylease/cli",
		environment: "node",
		globals: true,
		typecheck: {
			enabled: true,
		},
	},
});
