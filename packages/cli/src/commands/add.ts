import { access, mkdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { multiple, optional } from "@optique/core/modifiers";
import type { InferValue } from "@optique/core/parser";
import { argument, command, constant, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { KINDS, type Kind, OptionsError } from "rylease";
import { formatChangeFile, slug } from "rylease/internal";
import type { Io } from "../io.ts";

export const addCommand = command(
	"add",
	object({
		command: constant("add"),
		component: multiple(
			option("--component", string({ metavar: "NAME[:KIND]" }), {
				description: message`A component it changes; repeat for several`,
			}),
		),
		kind: optional(
			option("--kind", string({ metavar: "KIND" }), {
				description: message`breaking, feature, fix (default) or none`,
			}),
		),
		description: optional(
			option("--description", string({ metavar: "TEXT" }), {
				description: message`More about the change`,
			}),
		),
		directory: optional(
			option("--directory", string({ metavar: "DIR" }), {
				description: message`Where change files are kept; defaults to .changes`,
			}),
		),
		cwd: optional(
			option("--cwd", string({ metavar: "DIR" }), {
				description: message`The project; defaults to the working directory`,
			}),
		),
		title: multiple(argument(string({ metavar: "TITLE" }))),
	}),
	{
		brief: message`Write a change file, for the change-files preset`,
	},
);

export async function add(
	values: InferValue<typeof addCommand>,
	io: Io,
): Promise<number> {
	const title = values.title.join(" ").trim();
	if (title === "")
		throw new OptionsError([
			'add: say what changed, e.g. rylease add "Add dark mode"',
		]);
	const kind = kindOf(values.kind ?? "fix", "--kind");
	const kinds: Record<string, Kind> = {};
	for (const entry of values.component) {
		const [name = "", own] = entry.split(/:(?=[^:]*$)/);
		kinds[name] =
			own === undefined ? kind : kindOf(own, `--component ${entry}`);
	}
	if (Object.keys(kinds).length === 0) kinds.kind = kind;
	const cwd = resolve(io.cwd, values.cwd ?? ".");
	const directory = join(cwd, values.directory ?? ".changes");
	await mkdir(directory, { recursive: true });
	const base = slug(title);
	let path = join(directory, `${base}.md`);
	for (let n = 2; await exists(path); n++)
		path = join(directory, `${base}-${n}.md`);
	await writeFile(
		path,
		formatChangeFile({
			kinds,
			title,
			...(values.description && { description: values.description }),
		}),
		{ flag: "wx" },
	);
	io.write(`wrote ${relative(io.cwd, path)}\n`);
	return 0;
}

function kindOf(value: string, at: string): Kind {
	if (!(KINDS as readonly string[]).includes(value)) {
		throw new OptionsError([
			`${at}: '${value}' isn't a kind; use ${KINDS.join(", ")}`,
		]);
	}
	return value as Kind;
}

function exists(path: string): Promise<boolean> {
	return access(path).then(
		() => true,
		() => false,
	);
}
