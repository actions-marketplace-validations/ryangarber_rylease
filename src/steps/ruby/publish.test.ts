import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useFakeCommands } from "../../testing/commands.ts";
import { released, runStep } from "../../testing/step.ts";
import { rubyPublish } from "./publish.ts";

const commands = useFakeCommands();

let cwd: string;

beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "rylease-"));
	vi.stubEnv("GEM_HOST_API_KEY", "");
	await writeFile(join(cwd, "demo.gemspec"), "");
});

afterEach(async () => {
	await rm(cwd, { recursive: true, force: true });
});

/** A `gem` that builds a gem of `version`, as `gem build` reports it. */
const gem = (version: string) =>
	commands.define(
		"gem",
		`[ "$1" = build ] && printf '  Successfully built RubyGem\\n  Name: demo\\n  Version: ${version}\\n  File: package.gem\\n'; true`,
	);

function run(
	version: string,
	options: Parameters<typeof rubyPublish>[0] = {},
	dryRun = false,
) {
	return runStep(rubyPublish(options), released(version), { cwd, dryRun });
}

describe("ruby/publish", () => {
	it("builds the gem and pushes it, with the token", async () => {
		await gem("1.1.0.pre.rc.1");
		expect(await run("1.1.0-rc.1", { token: "secret" })).toEqual({
			output: {
				gemspec: "demo.gemspec",
				version: "1.1.0.pre.rc.1",
				host: "https://rubygems.org",
				gem: "demo-1.1.0.pre.rc.1.gem",
				published: true,
			},
			reason: "pushed demo-1.1.0.pre.rc.1.gem to https://rubygems.org",
		});
		const [build, push] = await commands.calls();
		const file = build?.args[3];
		expect(build?.args).toEqual([
			"build",
			"demo.gemspec",
			"--output",
			expect.stringMatching(/package\.gem$/),
		]);
		expect(push?.args).toEqual([
			"push",
			file,
			"--host",
			"https://rubygems.org",
		]);
		expect(push?.env.GEM_HOST_API_KEY).toBe("secret");
	});

	it("only says what it would push in a dry run", async () => {
		await gem("1.1.0");
		expect((await run("1.1.0", {}, true)).reason).toBe(
			"would build demo.gemspec and push it to https://rubygems.org",
		);
		expect(await commands.calls()).toEqual([]);
	});

	it("refuses to push another version", async () => {
		await gem("1.0.0");
		await expect(run("1.1.0")).rejects.toThrow(
			"demo.gemspec is at 1.0.0, not 1.1.0; write it first (fs/write-version, with format: ruby)",
		);
		expect((await commands.calls()).map(({ args }) => args[0])).toEqual([
			"build",
		]);
	});

	it("needs one gemspec, or the one to use", async () => {
		await writeFile(join(cwd, "other.gemspec"), "");
		await expect(run("1.1.0", {}, true)).rejects.toThrow(
			"demo.gemspec and other.gemspec are in .; set `gemspec` to one",
		);
		await expect(
			run("1.1.0", { gemspec: "other.gemspec" }, true),
		).resolves.toMatchObject({
			reason: "would build other.gemspec and push it to https://rubygems.org",
		});
	});
});
