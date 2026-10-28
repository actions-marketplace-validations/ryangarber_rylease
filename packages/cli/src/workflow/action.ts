import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { OptionsError } from "rylease";
import { parse } from "yaml";
import { isRecord } from "./parse.ts";

/** The rylease action a step uses, ready to run. */
export interface Action {
	/** As the step has it, e.g. `ryangarber/rylease@v2` or `./`. */
	uses: string;
	/** What runs, e.g. `ryangarber/rylease@v2 at f80fde7`. */
	label: string;
	/** Its directory, as `GITHUB_ACTION_PATH`. */
	path: string;
	/** The script it runs. */
	main: string;
	/** Its inputs' defaults, still unevaluated. */
	defaults: Record<string, string>;
}

/** `owner/rylease@ref`: a published rylease, under any owner. */
const REMOTE = /^([\w.-]+)\/(rylease)@([\w./-]+)$/;

/** Whether `uses` is rylease: published, or a local path to a rylease action. */
export async function isRylease(
	uses: string,
	workspace: string,
): Promise<boolean> {
	if (REMOTE.test(uses)) return true;
	if (!uses.startsWith("./")) return false;
	const manifest = await readManifest(resolve(workspace, uses)).catch(
		() => undefined,
	);
	return manifest?.name === "rylease";
}

/** Whether `uses` is rylease without looking at files: for steps before any checkout. */
export function looksLikeRylease(uses: string): boolean {
	return REMOTE.test(uses);
}

interface Manifest {
	name?: unknown;
	inputs?: unknown;
	runs?: unknown;
}

async function readManifest(directory: string): Promise<Manifest> {
	for (const name of ["action.yml", "action.yaml"]) {
		const text = await readFile(join(directory, name), "utf8").catch(
			() => undefined,
		);
		if (text !== undefined) {
			const value = parse(text) as unknown;
			return isRecord(value) ? value : {};
		}
	}
	throw new Error(`no action.yml in ${directory}`);
}

function fromManifest(
	manifest: Manifest,
	path: string,
	uses: string,
	label: string,
): Action {
	const runs = isRecord(manifest.runs) ? manifest.runs : {};
	if (
		typeof runs.main !== "string" ||
		!String(runs.using ?? "").startsWith("node")
	) {
		throw new OptionsError([
			`${uses}: expected a JavaScript action, with runs.main`,
		]);
	}
	const inputs = isRecord(manifest.inputs) ? manifest.inputs : {};
	return {
		uses,
		label,
		path,
		main: join(path, runs.main),
		defaults: Object.fromEntries(
			Object.entries(inputs).flatMap(([name, input]) =>
				isRecord(input) && input.default !== undefined
					? [[name, String(input.default)]]
					: [],
			),
		),
	};
}

/** A local action, e.g. `uses: ./`, from the job's checkout. */
export async function localAction(
	uses: string,
	workspace: string,
): Promise<Action> {
	const path = resolve(workspace, uses);
	return fromManifest(
		await readManifest(path),
		path,
		uses,
		"the checkout's rylease",
	);
}

/**
 * A published action, at the commit its ref is now, fetched once into the
 * cache: what CI would run.
 */
export async function remoteAction(uses: string): Promise<Action> {
	const match = REMOTE.exec(uses);
	if (!match) throw new OptionsError([`${uses}: expected owner/rylease@ref`]);
	const [, owner = "", repo = "", ref = ""] = match;
	const sha = await resolveRemoteRef(owner, repo, ref);
	const directory = join(cacheDirectory(), "actions", owner, repo, sha);
	let manifest = await readManifest(directory).catch(() => undefined);
	if (!manifest) {
		const base = `https://raw.githubusercontent.com/${owner}/${repo}/${sha}`;
		const text = await download(`${base}/action.yml`);
		manifest = parse(text) as Manifest;
		const runs = isRecord(manifest.runs) ? manifest.runs : {};
		if (typeof runs.main !== "string") {
			throw new OptionsError([`${uses}: its action.yml has no runs.main`]);
		}
		const main = join(directory, runs.main);
		await mkdir(dirname(main), { recursive: true });
		await writeFile(main, await download(`${base}/${runs.main}`));
		await writeFile(join(directory, "action.yml"), text);
	}
	return fromManifest(
		manifest,
		directory,
		uses,
		`${uses} at ${sha.slice(0, 7)}`,
	);
}

function cacheDirectory(): string {
	return join(
		process.env.XDG_CACHE_HOME || join(homedir(), ".cache"),
		"rylease",
	);
}

async function resolveRemoteRef(
	owner: string,
	repo: string,
	ref: string,
): Promise<string> {
	if (/^[0-9a-f]{40}$/.test(ref)) return ref;
	const url = `https://github.com/${owner}/${repo}.git`;
	const listing = await new Promise<string>((resolve, reject) => {
		execFile(
			"git",
			[
				"ls-remote",
				url,
				`refs/tags/${ref}`,
				`refs/tags/${ref}^{}`,
				`refs/heads/${ref}`,
			],
			(error, stdout, stderr) =>
				error
					? reject(
							new OptionsError([
								`can't look up ${owner}/${repo}@${ref}: ${stderr.trim() || error.message}`,
							]),
						)
					: resolve(stdout),
		);
	});
	const refs = new Map(
		listing
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => {
				const [sha = "", name = ""] = line.split("\t");
				return [name, sha] as const;
			}),
	);
	// An annotated tag's commit is what `^{}` peels it to.
	const sha =
		refs.get(`refs/tags/${ref}^{}`) ??
		refs.get(`refs/tags/${ref}`) ??
		refs.get(`refs/heads/${ref}`);
	if (!sha) {
		throw new OptionsError([
			`${owner}/${repo} has no tag or branch ${ref}; to test unreleased changes, pass --engine local`,
		]);
	}
	return sha;
}

async function download(url: string): Promise<string> {
	const response = await fetch(url);
	if (!response.ok)
		throw new OptionsError([
			`can't download ${url}: ${response.status} ${response.statusText}`,
		]);
	return response.text();
}

export interface ActionRun {
	/** The action's exit code. */
	code: number;
	/** What it wrote to `GITHUB_OUTPUT`. */
	outputs: Record<string, string>;
	/** What it wrote to `GITHUB_STEP_SUMMARY`. */
	summary: string;
}

export interface ActionRunOptions {
	/** The script to run, or, with `engine`, a module exporting `runAction`. */
	main: string;
	/** The engine's `rylease/internal` and `rylease` URLs, to run it instead of `main`. */
	engine?: { internal: string; index: string } | undefined;
	cwd: string;
	/** The step's whole environment, but for the files below. */
	env: Record<string, string>;
	/** The event's payload, for `GITHUB_EVENT_PATH`. */
	event: unknown;
	/** Gets each line it prints. */
	line: (text: string) => void;
}

/**
 * Runs the action in a process of its own, as the runner does, with files
 * for `GITHUB_OUTPUT`, `GITHUB_STEP_SUMMARY` and the event.
 */
export async function runAction(options: ActionRunOptions): Promise<ActionRun> {
	const scratch = await mkdtemp(join(tmpdir(), "rylease-step-"));
	try {
		const files = {
			GITHUB_OUTPUT: join(scratch, "output"),
			GITHUB_STEP_SUMMARY: join(scratch, "summary"),
			GITHUB_ENV: join(scratch, "env"),
			GITHUB_PATH: join(scratch, "path"),
			GITHUB_EVENT_PATH: join(scratch, "event.json"),
			RUNNER_TEMP: scratch,
		};
		for (const file of ["output", "summary", "env", "path"])
			await writeFile(join(scratch, file), "");
		await writeFile(
			files.GITHUB_EVENT_PATH,
			JSON.stringify(options.event, null, 2),
		);
		const args = options.engine
			? [
					"--input-type=module",
					"--eval",
					// The local engine's action, as dist/action.mjs would run it.
					`const { provideSelf, runAction } = await import(${JSON.stringify(options.engine.internal)});
provideSelf(${JSON.stringify(options.engine.index)});
process.exitCode = await runAction();`,
				]
			: [options.main];
		const code = await new Promise<number>((resolve, reject) => {
			const child = spawn(process.execPath, args, {
				cwd: options.cwd,
				env: { ...options.env, ...files },
				stdio: ["ignore", "pipe", "pipe"],
			});
			let pending = "";
			const take = (chunk: Buffer) => {
				pending += chunk.toString("utf8");
				const lines = pending.split("\n");
				pending = lines.pop() ?? "";
				for (const line of lines) options.line(line);
			};
			child.stdout.on("data", take);
			child.stderr.on("data", take);
			child.on("error", reject);
			child.on("close", (exit) => {
				if (pending) options.line(pending);
				resolve(exit ?? 1);
			});
		});
		return {
			code,
			outputs: parseOutputs(await readFile(files.GITHUB_OUTPUT, "utf8")),
			summary: await readFile(files.GITHUB_STEP_SUMMARY, "utf8"),
		};
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}

/** `GITHUB_OUTPUT`'s `name=value` and `name<<DELIMITER` … `DELIMITER` entries. */
export function parseOutputs(text: string): Record<string, string> {
	const outputs: Record<string, string> = {};
	const lines = text.split("\n");
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index] ?? "";
		const heredoc = /^([^=<]+)<<(.+)$/.exec(line);
		if (heredoc) {
			const [, name = "", delimiter = ""] = heredoc;
			const value: string[] = [];
			while (++index < lines.length && lines[index] !== delimiter)
				value.push(lines[index] ?? "");
			outputs[name] = value.join("\n");
		} else {
			const at = line.indexOf("=");
			if (at > 0) outputs[line.slice(0, at)] = line.slice(at + 1);
		}
	}
	return outputs;
}

/** The input's variable, as the runner names it: `INPUT_DRY-RUN` for `dry-run`. */
export function inputVariable(name: string): string {
	return `INPUT_${name.replaceAll(" ", "_").toUpperCase()}`;
}
