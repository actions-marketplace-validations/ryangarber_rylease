import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { released, runStep } from "../../testing/step.ts";
import { execCommand } from "./command.ts";

let cwd: string;

beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "rylease-"));
});

afterEach(async () => {
	await rm(cwd, { recursive: true, force: true });
});

const results = released("1.2.0");

describe("exec/command", () => {
	it("runs in the phase it's given", () => {
		expect(execCommand({ phase: "write", command: "true" }).phase).toBe(
			"write",
		);
		expect(execCommand({ phase: "release", command: "true" }).phase).toBe(
			"release",
		);
		expect(() => execCommand({ command: "true" } as never)).toThrow(/phase/);
	});

	it("runs its command with placeholders filled in, and lists its files", async () => {
		const output = await runStep(
			execCommand({
				phase: "write",
				command: "echo $GREETING {version}",
				env: { GREETING: "hi" },
				files: ["Cargo.lock"],
			}),
			results,
			{ cwd },
		);
		expect(output).toEqual({
			output: { command: "echo $GREETING 1.2.0", stdout: "hi 1.2.0" },
			files: ["Cargo.lock"],
			reason: "ran echo $GREETING 1.2.0: hi 1.2.0",
		});
	});

	it("only says what it would run in a dry run without a dryRun command", async () => {
		const output = await runStep(
			execCommand({ phase: "release", command: ["cargo", "publish"] }),
			results,
			{ cwd, dryRun: true },
		);
		expect(output.reason).toBe("would run cargo publish");
		expect(output.output).toEqual({ command: "cargo publish", stdout: null });
	});

	it("runs its dryRun command in a dry run", async () => {
		const output = await runStep(
			execCommand({
				phase: "release",
				command: "exit 1",
				dryRun: "echo dry {tag}",
			}),
			results,
			{ cwd, dryRun: true },
		);
		expect(output.reason).toBe("ran echo dry v1.2.0: dry v1.2.0");
	});
});
