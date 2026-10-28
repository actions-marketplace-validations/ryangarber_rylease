import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseChangeFile } from "../../../../src/steps/change-files/parse.ts";
import { useRepo } from "../../../../src/testing/repo.ts";
import { runCli } from "../testing/cli.ts";

const repo = useRepo();
const run = (...argv: string[]) => runCli(repo.cwd, ...argv);

describe("rylease add", () => {
	it("adds change files", async () => {
		expect(
			await run(
				"add",
				"--component",
				"core:feature",
				"--component",
				"@x/cli",
				"--kind",
				"fix",
				"Add dark mode",
			),
		).toEqual({ code: 0, out: "wrote .changes/add-dark-mode.md\n", err: "" });
		expect(
			(await run("add", "--description", "More.", "Add dark mode")).out,
		).toBe("wrote .changes/add-dark-mode-2.md\n");
		const files = await readdir(join(repo.cwd, ".changes"));
		expect(files.sort()).toEqual(["add-dark-mode-2.md", "add-dark-mode.md"]);
		expect(
			parseChangeFile(
				await readFile(join(repo.cwd, ".changes/add-dark-mode.md"), "utf8"),
				"x",
			),
		).toEqual({
			kinds: { core: "feature", "@x/cli": "fix" },
			title: "Add dark mode",
		});
		expect(
			parseChangeFile(
				await readFile(join(repo.cwd, ".changes/add-dark-mode-2.md"), "utf8"),
				"x",
			),
		).toEqual({
			kinds: { kind: "fix" },
			title: "Add dark mode",
			description: "More.",
		});
		expect((await run("add", "--kind", "huge", "X")).err).toBe(
			"rylease: --kind: 'huge' isn't a kind; use breaking, feature, fix, none\n",
		);
		expect((await run("add")).code).toBe(1);
	});
});
