import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useFakeCommands } from "../../testing/commands.ts";
import { released, runStep } from "../../testing/step.ts";
import { dartPublish } from "./publish.ts";

const commands = useFakeCommands();

let cwd: string;

beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "rylease-"));
	vi.stubEnv("PUB_TOKEN", "");
	await commands.define("dart");
	await commands.define("flutter");
});

afterEach(async () => {
	await rm(cwd, { recursive: true, force: true });
});

const pubspec = (text: string) => writeFile(join(cwd, "pubspec.yaml"), text);

function run(options: Parameters<typeof dartPublish>[0] = {}, dryRun = false) {
	return runStep(dartPublish(options), released("1.1.0"), { cwd, dryRun });
}

describe("dart/publish", () => {
	it("publishes to pub.dev, adding the token for it", async () => {
		await pubspec("name: pkg\nversion: 1.1.0\n");
		expect(await run({ token: "secret" })).toEqual({
			output: {
				name: "pkg",
				version: "1.1.0",
				client: "dart",
				server: "https://pub.dev",
				published: true,
			},
			reason: "published pkg 1.1.0 to https://pub.dev",
		});
		const calls = await commands.calls();
		expect(calls.map(({ command, args }) => [command, ...args])).toEqual([
			[
				"dart",
				"pub",
				"token",
				"add",
				"https://pub.dev",
				"--env-var",
				"PUB_TOKEN",
			],
			["dart", "pub", "publish", "--force"],
		]);
		expect(calls.map(({ env }) => env.PUB_TOKEN)).toEqual(["secret", "secret"]);
	});

	it("publishes a Flutter package with flutter, to its publish_to, with the client's own auth", async () => {
		await pubspec(
			"name: widgets\nversion: 1.1.0+4\npublish_to: https://pub.example.com\n\ndependencies:\n  flutter:\n    sdk: flutter\n",
		);
		expect((await run()).reason).toBe(
			"published widgets 1.1.0+4 to https://pub.example.com",
		);
		const calls = await commands.calls();
		expect(calls.map(({ command, args }) => [command, ...args])).toEqual([
			["flutter", "pub", "publish", "--force"],
		]);
		expect(calls[0]?.cwd).toBe(await realpath(cwd));
	});

	it("only says what it would publish in a dry run, as it would be written", async () => {
		await pubspec("name: pkg\nversion: 1.0.0\n");
		expect((await run({ client: "flutter" }, true)).reason).toBe(
			"would flutter pub publish pkg 1.1.0 to https://pub.dev",
		);
		await pubspec("name: pkg\nversion: 1.0.0+6\n");
		expect((await run({}, true)).reason).toBe(
			"would dart pub publish pkg 1.1.0+7 to https://pub.dev",
		);
		expect(await commands.calls()).toEqual([]);
	});

	it("refuses to publish another version, apps and unnamed packages", async () => {
		await pubspec("name: pkg\nversion: 1.0.0+3\n");
		await expect(run()).rejects.toThrow(
			"pubspec.yaml is at 1.0.0+3, not 1.1.0; write it first (fs/write-version, with format: dart)",
		);
		await pubspec("name: app\npublish_to: 'none'\nversion: 1.1.0\n");
		await expect(run({}, true)).rejects.toThrow(
			"pubspec.yaml has 'publish_to: none'; pub won't publish it",
		);
		await pubspec("version: 1.1.0\n");
		await expect(run({}, true)).rejects.toThrow("pubspec.yaml has no 'name'");
		expect(await commands.calls()).toEqual([]);
	});
});
