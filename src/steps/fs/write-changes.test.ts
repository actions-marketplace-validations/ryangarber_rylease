import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { released, runStep } from "../../testing/step.ts";
import { fsWriteChanges } from "./write-changes.ts";

let cwd: string;

beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "rylease-"));
	vi.useFakeTimers({ now: new Date("2026-10-20T12:00:00Z"), toFake: ["Date"] });
});

afterEach(async () => {
	vi.useRealTimers();
	await rm(cwd, { recursive: true, force: true });
});

const changelog = () => readFile(join(cwd, "CHANGELOG.md"), "utf8");

function write(
	options: Parameters<typeof fsWriteChanges>[0] = {},
	dryRun = false,
) {
	return runStep(
		fsWriteChanges(options),
		released("1.1.0", { notes: "- new\n" }),
		{ cwd, dryRun },
	);
}

describe("fs/write-changes", () => {
	it("creates the file, with a dated heading", async () => {
		expect(await write()).toEqual({
			output: {
				path: "CHANGELOG.md",
				entry: "## v1.1.0 (2026-10-20)\n\n- new",
				written: true,
			},
			files: ["CHANGELOG.md"],
			reason: "created CHANGELOG.md",
		});
		expect(await changelog()).toBe("## v1.1.0 (2026-10-20)\n\n- new\n");
	});

	it.each([
		["prepend", "prepended", "# v1.1.0\n\n- new\n\n# v1.0.0\n\n- old\n"],
		["append", "appended", "# v1.0.0\n\n- old\n\n# v1.1.0\n\n- new\n"],
		["replace", "replaced", "# v1.1.0\n\n- new\n"],
	] as const)("can %s", async (mode, done, content) => {
		await writeFile(join(cwd, "CHANGELOG.md"), "# v1.0.0\n\n- old\n\n");
		const output = await write({ heading: "# v{version}", mode });
		expect(output.reason).toBe(`${done} CHANGELOG.md`);
		expect(await changelog()).toBe(content);
	});

	it("writes to another path", async () => {
		await write({ path: "NOTES.md" });
		expect(await readFile(join(cwd, "NOTES.md"), "utf8")).toMatch(/^## v1/);
	});

	it("only says what it would do in a dry run", async () => {
		expect(await write({}, true)).toEqual({
			output: {
				path: "CHANGELOG.md",
				entry: "## v1.1.0 (2026-10-20)\n\n- new",
				written: false,
			},
			files: ["CHANGELOG.md"],
			reason: "would create CHANGELOG.md",
		});
		await expect(changelog()).rejects.toThrow("ENOENT");
		await writeFile(join(cwd, "CHANGELOG.md"), "old");
		expect((await write({ mode: "append" }, true)).reason).toBe(
			"would append CHANGELOG.md",
		);
	});

	it("fails on unknown placeholders and unreadable files", async () => {
		await expect(write({ heading: "{nope}" })).rejects.toThrow(
			"unknown placeholder {nope}",
		);
		await expect(write({ path: "." })).rejects.toThrow("EISDIR");
	});
});
