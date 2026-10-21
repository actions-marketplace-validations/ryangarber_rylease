import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPackages } from "./read.ts";

let cwd: string;

beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "rylease-"));
});

afterEach(async () => {
	await rm(cwd, { recursive: true, force: true });
});

describe("getPackages", () => {
	it("reads pnpm-workspace.yaml's packages", async () => {
		await writeFile(
			join(cwd, "pnpm-workspace.yaml"),
			'catalog:\n  - x\npackages:\n  - "a/*"\n  - b # c\n\n  - !d\nonlyBuilt: []\n',
		);
		expect(await getPackages(cwd)).toEqual(["a/*", "b"]);
	});
});
