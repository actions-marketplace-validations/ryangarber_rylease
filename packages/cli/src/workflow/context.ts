import { git, OptionsError, tryGit } from "rylease";
import { detectRepo } from "rylease/internal";
import { type Mocks, setPath } from "./mocks.ts";
import { isRecord, type Workflow } from "./parse.ts";

/** The run being simulated: the event, and what GitHub would know of it. */
export interface Run {
	eventName: string;
	/** The `github` context, before each job and step fills in its own. */
	github: Record<string, unknown>;
	/** The `inputs` context, typed as each input says. */
	inputs: Record<string, unknown>;
	vars: Record<string, string>;
	secrets: Record<string, string>;
	/** The commit the event is for, e.g. what `actions/checkout` checks out by default. */
	sha: string;
	/** The commits of the refs the event is about, e.g. `refs/heads/main`, as CI has them. */
	refs: Map<string, string>;
	/** Uncommitted changes to lay over checkouts of a commit (HEAD), as a tree. */
	changes: Map<string, string>;
	defaultBranch: string;
	/** What was supposed, for want of a value, to report. */
	notes: string[];
}

/** Activity types events get by default. */
const DEFAULT_TYPES: Record<string, string> = {
	pull_request: "opened",
	pull_request_target: "opened",
	workflow_run: "completed",
	release: "published",
	issues: "opened",
	issue_comment: "created",
};

export interface RunOptions {
	cwd: string;
	workflow: Workflow;
	mocks: Mocks;
	/** The working copy's changes, as a tree, to lay over checkouts of HEAD. */
	snapshot?: string | undefined;
}

export async function makeRun({
	cwd,
	workflow,
	mocks,
	snapshot,
}: RunOptions): Promise<Run> {
	const notes: string[] = [];
	const eventName = mocks.event ?? "push";
	const type = mocks.type ?? DEFAULT_TYPES[eventName];
	const defaultBranch = mocks.defaultBranch ?? (await detectDefaultBranch(cwd));
	const detected = await detectRepo(cwd);
	if (!detected)
		notes.push(
			"no GitHub repository in the origin remote; supposed owner/repo",
		);
	const repository = detected ?? "owner/repo";
	const [owner = "owner", name = "repo"] = repository.split("/");
	const current =
		(await tryGit(cwd, "symbolic-ref", "--short", "-q", "HEAD")) ?? "HEAD";
	// The refs the event is about, as CI has them, e.g. for checkouts of `github.ref`.
	const refs = new Map<string, string>();
	const known = (resolved: { ref: string; name: string; sha: string }) => {
		refs.set(resolved.ref, resolved.sha);
		refs.set(resolved.name, resolved.sha);
		return resolved;
	};
	const target = known(await resolveRef(cwd, mocks.ref ?? current));
	const pushed = await compareWithOrigin(cwd, target);
	if (pushed) notes.push(pushed);
	const head = await git(cwd, "rev-parse", "HEAD");
	const changes = new Map<string, string>();
	if (snapshot) changes.set(head, snapshot);

	const actor = owner;
	const repo = {
		id: 1,
		name,
		full_name: repository,
		owner: { login: owner },
		default_branch: defaultBranch,
		html_url: `https://github.com/${repository}`,
		private: false,
	};
	const sender = { login: actor, type: "User" };
	const commit = async (sha: string) => ({
		id: sha,
		message: await git(cwd, "log", "-1", "--format=%B", sha),
		timestamp: await git(cwd, "log", "-1", "--format=%cI", sha),
		author: { name: await git(cwd, "log", "-1", "--format=%an", sha) },
	});

	// What the event is for, and the ref and commit GitHub runs it on.
	let ref = target.ref;
	let sha = target.sha;
	let headRef = "";
	let baseRef = "";
	let payload: Record<string, unknown>;
	const declared = dispatchInputs(workflow, eventName);
	const { inputs, strings } = typedInputs(
		declared,
		mocks.inputs,
		eventName,
		notes,
	);

	switch (eventName) {
		case "push":
			payload = {
				ref,
				before: (await tryGit(cwd, "rev-parse", `${sha}^`)) ?? "0".repeat(40),
				after: sha,
				created: false,
				deleted: false,
				forced: false,
				head_commit: await commit(sha),
				commits: [await commit(sha)],
				pusher: { name: actor },
			};
			break;
		case "pull_request":
		case "pull_request_target": {
			const base = known(await resolveRef(cwd, defaultBranch));
			headRef = target.name;
			baseRef = defaultBranch;
			ref = eventName === "pull_request" ? "refs/pull/1/merge" : base.ref;
			if (eventName === "pull_request_target") sha = base.sha;
			payload = {
				action: type,
				number: 1,
				pull_request: {
					number: 1,
					title: (await commit(target.sha)).message.split("\n")[0],
					state: type === "closed" ? "closed" : "open",
					merged: false,
					draft: false,
					labels: [],
					user: sender,
					head: { ref: target.name, sha: target.sha, repo },
					base: { ref: defaultBranch, sha: base.sha, repo },
				},
			};
			break;
		}
		case "workflow_dispatch":
			payload = { inputs: strings, ref, workflow: workflow.file };
			break;
		case "workflow_run": {
			// It runs on the default branch, for a run of another workflow on the ref.
			const base = known(await resolveRef(cwd, defaultBranch));
			ref = base.ref;
			sha = base.sha;
			const workflows =
				(isRecord(workflow.on.workflow_run) &&
					workflow.on.workflow_run.workflows) ||
				[];
			const triggering =
				mocks.workflow ?? [workflows].flat().map(String)[0] ?? "ci";
			payload = {
				action: type,
				workflow: { name: triggering },
				workflow_run: {
					id: 1,
					name: triggering,
					event: "push",
					status: type === "completed" ? "completed" : "in_progress",
					conclusion: type === "completed" ? "success" : null,
					head_branch: target.name,
					head_sha: target.sha,
					run_number: 1,
					run_attempt: 1,
					html_url: `https://github.com/${repository}/actions/runs/1`,
				},
			};
			break;
		}
		case "schedule": {
			const base = known(await resolveRef(cwd, defaultBranch));
			ref = base.ref;
			sha = base.sha;
			const schedule = [workflow.on.schedule ?? []].flat()[0];
			payload = { schedule: isRecord(schedule) ? schedule.cron : undefined };
			break;
		}
		default:
			payload = { ...(type && { action: type }) };
			notes.push(
				`there's no made-up payload for ${eventName}; pass one with payload in the mocks`,
			);
	}
	payload = mocks.payload ?? { ...payload, repository: repo, sender };

	const github: Record<string, unknown> = {
		action: "",
		action_path: "",
		action_ref: "",
		action_repository: "",
		actor,
		actor_id: "1",
		api_url: "https://api.github.com",
		base_ref: baseRef,
		event: payload,
		event_name: eventName,
		graphql_url: "https://api.github.com/graphql",
		head_ref: headRef,
		job: "",
		ref,
		ref_name: ref
			.replace(/^refs\/(heads|tags)\//, "")
			.replace(/^refs\/pull\//, ""),
		ref_protected: false,
		ref_type: ref.startsWith("refs/tags/") ? "tag" : "branch",
		repository,
		repository_id: "1",
		repository_owner: owner,
		repository_owner_id: "1",
		repositoryUrl: `git://github.com/${repository}.git`,
		retention_days: "90",
		run_attempt: "1",
		run_id: String(Date.now()),
		run_number: "1",
		secret_source: "Actions",
		server_url: "https://github.com",
		sha,
		token: mocks.token ?? "",
		triggering_actor: actor,
		workflow: workflow.name,
		workflow_ref: `${repository}/${workflow.file}@${ref}`,
		workflow_sha: sha,
		workspace: "",
	};
	for (const [path, value] of Object.entries(mocks.set)) {
		setPath(github, path.replace(/^github\./, ""), value);
	}
	// `--set github.sha=...` and the like move the checkout too.
	const mockedSha = typeof github.sha === "string" ? github.sha : sha;
	return {
		eventName,
		github,
		inputs,
		vars: mocks.vars,
		secrets: { GITHUB_TOKEN: mocks.token ?? "", ...mocks.secrets },
		sha: mockedSha,
		changes,
		refs,
		defaultBranch,
		notes,
	};
}

interface DeclaredInput {
	type?: string;
	default?: unknown;
	required?: boolean;
}

function dispatchInputs(
	workflow: Workflow,
	eventName: string,
): Record<string, DeclaredInput> {
	const trigger = workflow.on[eventName];
	if (!isRecord(trigger) || !isRecord(trigger.inputs)) return {};
	return Object.fromEntries(
		Object.entries(trigger.inputs).map(([name, value]) => [
			name,
			isRecord(value) ? (value as DeclaredInput) : {},
		]),
	);
}

/** Inputs as `inputs` has them (typed) and as the payload has them (text). */
function typedInputs(
	declared: Record<string, DeclaredInput>,
	given: Record<string, string>,
	eventName: string,
	notes: string[],
): { inputs: Record<string, unknown>; strings: Record<string, string> } {
	const unknown = Object.keys(given).filter((name) => !(name in declared));
	if (unknown.length > 0) {
		throw new OptionsError(
			unknown.map((name) =>
				Object.keys(declared).length > 0
					? `--input ${name}: ${eventName} has no such input; use ${Object.keys(declared).join(", ")}`
					: `--input ${name}: ${eventName} takes no inputs here`,
			),
		);
	}
	const inputs: Record<string, unknown> = {};
	const strings: Record<string, string> = {};
	for (const [name, input] of Object.entries(declared)) {
		const text =
			given[name] ??
			(input.default === undefined ? undefined : String(input.default));
		if (text === undefined) {
			if (input.required) {
				throw new OptionsError([`--input ${name}: ${eventName} requires it`]);
			}
			inputs[name] = input.type === "boolean" ? false : "";
			strings[name] = input.type === "boolean" ? "false" : "";
			continue;
		}
		if (given[name] === undefined)
			notes.push(`input ${name} is its default, '${text}'`);
		strings[name] = text;
		inputs[name] =
			input.type === "boolean"
				? text === "true"
				: input.type === "number"
					? Number(text)
					: text;
	}
	return { inputs, strings };
}

/** How a branch differs from origin's, which is what CI runs; `undefined` if it doesn't. */
async function compareWithOrigin(
	cwd: string,
	target: { ref: string; name: string; sha: string },
) {
	if (!target.ref.startsWith("refs/heads/")) return undefined;
	const remote = `refs/remotes/origin/${target.name}`;
	const counts = await tryGit(
		cwd,
		"rev-list",
		"--left-right",
		"--count",
		`${remote}...${target.sha}`,
	);
	if (!counts)
		return `${target.name} isn't pushed to origin; CI runs on what's pushed`;
	const [behind = 0, ahead = 0] = counts.split(/\s+/).map(Number);
	if (behind === 0 && ahead === 0) return undefined;
	const parts = [
		ahead > 0 && `${ahead} ahead of`,
		behind > 0 && `${behind} behind`,
	].filter(Boolean);
	return `${target.name} is ${parts.join(" and ")} origin/${target.name} (as last fetched); CI runs on what's pushed`;
}

async function detectDefaultBranch(cwd: string): Promise<string> {
	const remote = await tryGit(
		cwd,
		"symbolic-ref",
		"--short",
		"-q",
		"refs/remotes/origin/HEAD",
	);
	if (remote) return remote.replace(/^origin\//, "");
	for (const name of ["main", "master"]) {
		if (await tryGit(cwd, "rev-parse", "--verify", "-q", `refs/heads/${name}`))
			return name;
	}
	return (await tryGit(cwd, "symbolic-ref", "--short", "-q", "HEAD")) ?? "main";
}

/** A branch, tag or full ref as GitHub has it: `refs/heads/x`, with its commit. */
export async function resolveRef(
	cwd: string,
	name: string,
): Promise<{ ref: string; name: string; sha: string }> {
	const candidates = name.startsWith("refs/")
		? [name]
		: [
				`refs/heads/${name}`,
				`refs/tags/${name}`,
				`refs/remotes/origin/${name}`,
				`refs/remotes/${name}`,
			];
	for (const candidate of candidates) {
		const sha = await tryGit(
			cwd,
			"rev-parse",
			"--verify",
			"-q",
			`${candidate}^{commit}`,
		);
		if (sha) {
			// origin's branches, as `main` or `origin/main`, are its branches in CI.
			const ref = candidate.replace(
				/^refs\/remotes\/(origin\/)?/,
				"refs/heads/",
			);
			return { ref, name: ref.replace(/^refs\/(heads|tags)\//, ""), sha };
		}
	}
	const sha = await tryGit(
		cwd,
		"rev-parse",
		"--verify",
		"-q",
		`${name}^{commit}`,
	);
	if (sha) return { ref: "refs/heads/HEAD", name: "HEAD", sha };
	throw new OptionsError([`--ref: no branch, tag or commit '${name}' here`]);
}
