import type {
	AllStepDefinition,
	AllStepOutput,
	Change,
	ComponentInfo,
	Dependency,
	EachStepDefinition,
	Environment,
	Phase,
	StepOutputs,
	StepResults,
} from "../core/types.ts";
import { versionValues } from "../utils/template.ts";

/** The whole project, as one component. */
export const root: ComponentInfo = {
	name: "root",
	path: ".",
	dependsOn: [],
	pathspec: [],
};

/**
 * What a step receives: the component defaults to {@link root}, the tag to
 * `v{version}`, and the placeholders to the version's.
 */
export type Results<T extends Phase> = Omit<
	StepResults[T],
	"component" | "tag" | "placeholders" | "dependencies"
> & {
	component?: ComponentInfo;
	tag?: string;
	placeholders?: Readonly<Record<string, string>>;
	dependencies?: readonly Dependency[];
};

type Fields = { version?: string; tag?: string };

function input(env: Partial<Environment>) {
	return {
		env: { cwd: "/", branch: "main", dryRun: false, ...env },
		context: undefined,
		history: [],
	};
}

/**
 * Runs one step on its own, given what earlier phases would have produced;
 * an `all` step gets one component, or each of `results` when it's a list.
 */
export async function runStep<T extends Phase>(
	step: EachStepDefinition<T>,
	results: NoInfer<Results<T>>,
	env?: Partial<Environment>,
): Promise<StepOutputs[T]>;
export async function runStep<T extends Phase>(
	step: AllStepDefinition<T>,
	results: NoInfer<Results<T> | readonly Results<T>[]>,
	env?: Partial<Environment>,
): Promise<AllStepOutput<T>>;
export async function runStep(
	step: { scope?: "each" | "all"; run: (input: never) => unknown },
	results: Fields | readonly Fields[],
	env: Partial<Environment> = {},
): Promise<unknown> {
	const withRoot = (result: Fields) => {
		const { version } = result;
		const tag =
			result.tag ?? (version === undefined ? undefined : `v${version}`);
		return {
			component: root,
			...(version !== undefined && {
				dependencies: [],
				tag,
				placeholders: { ...versionValues(version), tag, name: root.name },
			}),
			...result,
		};
	};
	const run = step.run as (input: unknown) => unknown;
	if (step.scope === "all") {
		const list = Array.isArray(results) ? results : [results];
		return run({ components: list.map(withRoot), ...input(env) });
	}
	return run({ ...withRoot(results as Fields), ...input(env) });
}

/** What a `release` step receives for a release of `version`, tagged `v{version}`. */
export function released(
	version: string,
	results: Partial<Results<"release">> = {},
): Results<"release"> {
	const tag = results.tag ?? `v${version}`;
	const name = results.component?.name ?? root.name;
	return {
		previousVersion: "1.0.0",
		changes: [],
		kind: "feature",
		version,
		tag,
		placeholders: { ...versionValues(version), version, tag, name },
		notes: "",
		releases: [],
		...results,
	};
}

/** A change as a commit would give it. */
export function change(title: string, description?: string): Change {
	return {
		title,
		...(description ? { description } : {}),
		reason: "commit abc1234",
	};
}
