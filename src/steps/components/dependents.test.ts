import type { ComponentInfo, Kind } from "../../core/types.ts";
import { runStep } from "../../testing/step.ts";
import { componentsDependents } from "./dependents.ts";

const component = (name: string, ...dependsOn: string[]): ComponentInfo => ({
	name,
	path: `packages/${name}`,
	dependsOn,
	pathspec: [`packages/${name}`],
});

const results = (kind: Kind, info: ComponentInfo) => ({
	component: info,
	changes: [],
	kind,
});

describe("components/dependents", () => {
	it("releases dependents of released components, and theirs", async () => {
		expect(
			await runStep(componentsDependents(), [
				results("feature", component("core")),
				results("none", component("utils")),
				results("none", component("cli", "core", "utils")),
				results("none", component("web", "cli")),
				results("breaking", component("api", "core")),
				results("none", component("docs", "utils")),
			]),
		).toEqual({
			results: {
				cli: { kind: "fix", reason: "depends on core, released too" },
				web: { kind: "fix", reason: "depends on cli, released too" },
			},
			reason: "2 dependents released: cli and web",
		});
	});

	it("raises them to a given kind", async () => {
		const output = await runStep(componentsDependents({ kind: "feature" }), [
			results("fix", component("core")),
			results("fix", component("cli", "core")),
		]);
		expect(output.results).toEqual({
			cli: { kind: "feature", reason: "depends on core, released too" },
		});
		expect(
			(
				await runStep(componentsDependents(), [
					results("none", component("core")),
					results("none", component("cli", "core")),
				])
			).reason,
		).toBe("no dependents of released components");
	});
});
