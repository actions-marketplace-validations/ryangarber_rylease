import { isAbsolute, normalize, relative, sep } from "node:path";
import { type FactoryDefinition, makeFactory } from "./factory.ts";
import type { History } from "./history.ts";
import { OptionsError, type OptionsShape } from "./options.ts";
import type { Scheme } from "./scheme.ts";
import type { ComponentInfo, Environment } from "./types.ts";

/** A versioned unit of the project; see {@link ComponentInfo}. */
export interface Component {
	name: string;
	/** Its directory, relative to the project. Defaults to `.`. */
	path?: string;
	/** Components it depends on, by name. */
	dependsOn?: readonly string[];
	/** Overrides the release's scheme. */
	scheme?: Scheme;
	/** Overrides the release's tag template. */
	tag?: string;
	/** Overrides where the release finds previous versions. */
	history?: History;
}

/** Finds a project's components, e.g. the packages of a workspace. */
export interface ComponentSource {
	readonly name: string;
	resolve(env: Environment): Promise<Component[]>;
}

/** Defines a source of components, with options as a zod shape. */
export function defineComponents<
	const N extends string,
	S extends OptionsShape,
>(definition: FactoryDefinition<N, S, ComponentSource>) {
	return makeFactory("components", definition);
}

/** A component with everything worked out. */
export interface ResolvedComponent {
	info: ComponentInfo;
	scheme: Scheme;
	history: History;
	/** The tag template, with `{name}` filled in. */
	tag: string;
}

export interface Defaults {
	scheme: Scheme;
	history: History;
	/** Defaults to `v{version}` for one component, `{name}@{version}` for more. */
	tag: string | undefined;
}

/**
 * Checks components and fills in their defaults, ordered so that each comes
 * after the components it depends on.
 */
export function resolveComponents(
	components: readonly Component[],
	defaults: Defaults,
): ResolvedComponent[] {
	const issues: string[] = [];
	const names = new Set<string>();
	for (const [index, component] of components.entries()) {
		if (typeof component.name !== "string" || component.name === "") {
			issues.push(`components[${index}].name: expected a name`);
		} else if (names.has(component.name)) {
			issues.push(
				`components[${index}].name: '${component.name}' is listed twice`,
			);
		}
		names.add(component.name);
	}
	const paths = components.map((component, index) => {
		const path = normalize(component.path ?? ".").replaceAll(sep, "/");
		if (isAbsolute(path) || path === ".." || path.startsWith("../")) {
			issues.push(
				`components[${index}].path: '${component.path}' must be inside the project`,
			);
		}
		return path.replace(/\/$/, "");
	});
	for (const [index, component] of components.entries()) {
		for (const dependency of component.dependsOn ?? []) {
			if (!names.has(dependency)) {
				issues.push(
					`components[${index}].dependsOn: '${dependency}' isn't a component`,
				);
			}
		}
	}
	const several = components.length > 1;
	const tags = components.map((component) => {
		const template =
			component.tag ??
			defaults.tag ??
			(several ? "{name}@{version}" : "v{version}");
		return template.replaceAll("{name}", component.name);
	});
	for (const [index, tag] of tags.entries()) {
		const at =
			components[index]?.tag === undefined ? "tag" : `components[${index}].tag`;
		const unknown = [...tag.matchAll(/\{(\w+)\}/g)]
			.map(([, name]) => name)
			.filter((name) => name !== "version");
		if (!tag.includes("{version}")) {
			issues.push(`${at}: '${tag}' has no {version} placeholder`);
		} else if (unknown.length > 0) {
			issues.push(
				`${at}: unknown placeholder {${unknown[0]}} in '${tag}'; use {version} or {name}`,
			);
		}
	}
	const seen = new Map<string, string>();
	for (const [index, tag] of tags.entries()) {
		const other = seen.get(tag);
		const name = components[index]?.name ?? "";
		if (other !== undefined) {
			issues.push(
				`components: '${other}' and '${name}' share the tag '${tag}'; add {name} to it`,
			);
		}
		seen.set(tag, name);
	}
	if (issues.length > 0) throw new OptionsError(issues);

	const resolved = components.map((component, index): ResolvedComponent => {
		const path = paths[index] ?? ".";
		const nested = paths.filter(
			(other, i) => i !== index && isInside(other, path),
		);
		const whole = path === "." && nested.length === 0;
		return {
			info: {
				name: component.name,
				path,
				dependsOn: [...(component.dependsOn ?? [])],
				pathspec: whole
					? []
					: [path, ...nested.map((other) => `:(exclude)${other}`)],
			},
			scheme: component.scheme ?? defaults.scheme,
			history: component.history ?? defaults.history,
			tag: tags[index] ?? "",
		};
	});
	return dependencyOrder(resolved);
}

/** Whether `path` is strictly inside `parent`, both relative to the project. */
function isInside(path: string, parent: string): boolean {
	if (path === parent) return false;
	if (parent === ".") return path !== ".";
	const between = relative(parent, path);
	return between !== "" && !between.startsWith("..") && !isAbsolute(between);
}

/** Dependencies first, otherwise in the order given. */
function dependencyOrder(components: ResolvedComponent[]): ResolvedComponent[] {
	const ordered: ResolvedComponent[] = [];
	const done = new Set<string>();
	let remaining = components;
	while (remaining.length > 0) {
		const ready = remaining.filter(({ info }) =>
			info.dependsOn.every((name) => done.has(name)),
		);
		if (ready.length === 0) {
			throw new OptionsError([
				`components: ${remaining.map(({ info }) => info.name).join(", ")} depend on each other in a cycle`,
			]);
		}
		for (const component of ready) {
			ordered.push(component);
			done.add(component.info.name);
		}
		remaining = remaining.filter((component) => !ready.includes(component));
	}
	return ordered;
}
