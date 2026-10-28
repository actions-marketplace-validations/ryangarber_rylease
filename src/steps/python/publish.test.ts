import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useFakeCommands } from "../../testing/commands.ts";
import { released, runStep } from "../../testing/step.ts";
import { pythonPublish } from "./publish.ts";
import { normalizePython } from "./version.ts";

const commands = useFakeCommands();

let cwd: string;

beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "rylease-"));
	vi.stubEnv("PYPI_TOKEN", "");
	await commands.define("uv");
	await commands.define("twine");
	await mkdir(join(cwd, "dist"));
	for (const name of [
		"my_pkg-1.0.0.tar.gz",
		"my_pkg-1.0.0-py3-none-any.whl",
		"my_pkg-1.1.0rc1.tar.gz",
		"my_pkg-1.1.0rc1-py3-none-any.whl",
		".gitignore",
	]) {
		await writeFile(join(cwd, "dist", name), "");
	}
});

afterEach(async () => {
	await rm(cwd, { recursive: true, force: true });
});

function run(
	version: string,
	options: Parameters<typeof pythonPublish>[0] = {},
	dryRun = false,
) {
	return runStep(pythonPublish(options), released(version), { cwd, dryRun });
}

const ours = [
	"dist/my_pkg-1.1.0rc1-py3-none-any.whl",
	"dist/my_pkg-1.1.0rc1.tar.gz",
];

describe("python/publish", () => {
	it("uploads the version's distributions with uv, and the token", async () => {
		expect(await run("1.1.0-rc.1", { token: "secret" })).toEqual({
			output: {
				version: "1.1.0rc1",
				files: ours,
				client: "uv",
				registry: "https://upload.pypi.org/legacy/",
				published: true,
			},
			reason: `uploaded ${ours.join(" and ")} to https://upload.pypi.org/legacy/`,
		});
		const [call] = await commands.calls();
		expect(call?.args).toEqual([
			"publish",
			"--publish-url",
			"https://upload.pypi.org/legacy/",
			...ours.map((file) => expect.stringMatching(new RegExp(`/${file}$`))),
		]);
		expect(call?.env.UV_PUBLISH_TOKEN).toBe("secret");
	});

	it("uploads with twine, to another index", async () => {
		vi.stubEnv("PYPI_TOKEN", "from-env");
		await run("1.0.0", {
			client: "twine",
			registry: "https://test.pypi.org/legacy/",
		});
		const [call] = await commands.calls();
		expect(call?.args.slice(0, 4)).toEqual([
			"upload",
			"--non-interactive",
			"--repository-url",
			"https://test.pypi.org/legacy/",
		]);
		expect(call?.args).toHaveLength(6);
		expect(call?.env.TWINE_USERNAME).toBe("__token__");
		expect(call?.env.TWINE_PASSWORD).toBe("from-env");
	});

	it("only says what it would upload in a dry run", async () => {
		expect((await run("1.0.0", {}, true)).reason).toBe(
			"would uv upload dist/my_pkg-1.0.0-py3-none-any.whl and dist/my_pkg-1.0.0.tar.gz to https://upload.pypi.org/legacy/",
		);
		expect(await commands.calls()).toEqual([]);
	});

	it("needs distributions of the version, but not in a dry run", async () => {
		await expect(run("2.0.0")).rejects.toThrow(
			"no distributions of 2.0.0 in dist/*, only of 1.0.0 and 1.1.0rc1; build them first",
		);
		await expect(run("2.0.0", { files: "missing/*" })).rejects.toThrow(
			"no files match 'missing/*'",
		);
		expect((await run("2.0.0", { files: "missing/*" }, true)).reason).toBe(
			"would uv upload the distributions of 2.0.0 in missing/* to https://upload.pypi.org/legacy/, once built",
		);
		expect(await commands.calls()).toEqual([]);
	});
});

describe("normalizePython", () => {
	it.each([
		["1.0.0", "1.0.0"],
		["v2026.01.0", "2026.1.0"],
		["1.0.0-rc.1", "1.0.0rc1"],
		["1.0.0-alpha.2", "1.0.0a2"],
		["1.0.0.beta", "1.0.0b0"],
		["1.0.0-preview.3", "1.0.0rc3"],
		["1.0.0rc1.post2.dev3", "1.0.0rc1.post2.dev3"],
		["1.0-1", "1.0.post1"],
		["1.0.0+Local-Build_1", "1.0.0+local.build.1"],
		["1.0.0-next.1", "1.0.0-next.1"],
	])("%s is %s", (version, normalized) => {
		expect(normalizePython(version)).toBe(normalized);
	});
});
