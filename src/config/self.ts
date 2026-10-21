import { registerHooks } from "node:module";

/**
 * Lets custom steps `import { defineStep, z } from "rylease"` without
 * installing it: the import resolves to the running bundle, `url`.
 */
export function provideSelf(url: string): void {
	registerHooks({
		resolve: (specifier, context, next) =>
			specifier === "rylease"
				? { url, shortCircuit: true }
				: next(specifier, context),
	});
}
