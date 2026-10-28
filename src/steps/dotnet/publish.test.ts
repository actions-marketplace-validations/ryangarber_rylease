import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useFakeCommands } from "../../testing/commands.ts";
import { released, runStep } from "../../testing/step.ts";
import { dotnetPublish } from "./publish.ts";

const commands = useFakeCommands();

let cwd: string;

beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "rylease-"));
	vi.stubEnv("NUGET_API_KEY", "");
	await commands.define("dotnet");
	for (const dir of ["src/Lib/bin/Release", "src/Lib.Extra/bin/Release"]) {
		await mkdir(join(cwd, dir), { recursive: true });
	}
	for (const file of [
		"src/Lib/bin/Release/Lib.1.0.0.nupkg",
		"src/Lib/bin/Release/Lib.1.1.0-rc.1.nupkg",
		"src/Lib/bin/Release/Lib.1.1.0-rc.1.snupkg",
		"src/Lib/bin/Release/Lib.1.1.0-rc.1.symbols.nupkg",
		"src/Lib.Extra/bin/Release/Lib.Extra.1.1.0-rc.1.nupkg",
	]) {
		await writeFile(join(cwd, file), "");
	}
});

afterEach(async () => {
	await rm(cwd, { recursive: true, force: true });
});

function run(
	version: string,
	options: Parameters<typeof dotnetPublish>[0] = {},
	dryRun = false,
) {
	return runStep(dotnetPublish(options), released(version), { cwd, dryRun });
}

const ours = [
	"src/Lib.Extra/bin/Release/Lib.Extra.1.1.0-rc.1.nupkg",
	"src/Lib/bin/Release/Lib.1.1.0-rc.1.nupkg",
];

describe("dotnet/publish", () => {
	it("pushes each package of the version, with the key", async () => {
		expect(await run("1.1.0-RC.1+abc", { token: "secret" })).toEqual({
			output: {
				files: ours,
				source: "https://api.nuget.org/v3/index.json",
				published: true,
			},
			reason: `pushed ${ours.join(" and ")} to https://api.nuget.org/v3/index.json`,
		});
		const calls = await commands.calls();
		expect(calls.map(({ args }) => args)).toEqual(
			ours.map((file) => [
				"nuget",
				"push",
				expect.stringMatching(new RegExp(`${file}$`)),
				"--source",
				"https://api.nuget.org/v3/index.json",
				"--api-key",
				"secret",
			]),
		);
	});

	it("keeps the key out of errors", async () => {
		await commands.define("dotnet", "echo 'denied' >&2; exit 1");
		vi.stubEnv("NUGET_API_KEY", "secret");
		const error = await run("1.0.0").catch((error: unknown) => error);
		expect(String(error)).toMatch(/--api-key \*\*\* failed: denied$/);
		expect(String(error)).not.toContain("secret");
	});

	it("only says what it would push in a dry run", async () => {
		expect((await run("1.0.0", {}, true)).reason).toBe(
			"would push src/Lib/bin/Release/Lib.1.0.0.nupkg to https://api.nuget.org/v3/index.json",
		);
		expect(await commands.calls()).toEqual([]);
	});

	it("needs packages of the version, but not in a dry run", async () => {
		await expect(run("2.0.0")).rejects.toThrow(
			"no packages of 2.0.0 in **/*.nupkg; pack them first",
		);
		expect((await run("2.0.0", {}, true)).reason).toBe(
			"would push the packages of 2.0.0 in **/*.nupkg to https://api.nuget.org/v3/index.json, once packed",
		);
		expect(await commands.calls()).toEqual([]);
	});
});
