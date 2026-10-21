import { createHash } from "node:crypto";
import { join } from "node:path";
import {
	github,
	useArtifactService,
	useFakeGitHub,
} from "../../testing/github.ts";
import { unzip } from "../../testing/unzip.ts";
import { canUploadArtifacts, uploadFiles } from "./artifact.ts";

const fake = useFakeGitHub();

describe("canUploadArtifacts", () => {
	it("is true only in a job with the artifact service", () => {
		expect(canUploadArtifacts()).toBe(false);
		useArtifactService(fake);
		expect(canUploadArtifacts()).toBe(true);
	});
});

describe("uploadFiles", () => {
	it("zips files relative to their closest common directory", async () => {
		useArtifactService(fake);
		const dist = join(fake.cwd, "dist");
		const uploaded = await uploadFiles("build", [
			join(dist, "app.exe"),
			join(dist, "nested", "latest.json"),
		]);
		expect(uploaded).toEqual({
			id: "42",
			files: ["app.exe", "nested/latest.json"],
			size: 9,
		});
		const artifact = github.artifacts.get("build");
		expect(artifact?.hash).toBe(
			`sha256:${createHash("sha256")
				.update(artifact?.content ?? "")
				.digest("hex")}`,
		);
		expect(await unzip(artifact?.content)).toEqual({
			"app.exe": "windows",
			"nested/latest.json": "{}",
		});
	});

	it("keeps a single file at the top", async () => {
		useArtifactService(fake);
		const file = join(fake.cwd, "dist", "nested", "latest.json");
		expect((await uploadFiles("one", [file])).files).toEqual(["latest.json"]);
	});

	it("needs the artifact service", async () => {
		const file = join(fake.cwd, "dist", "app.exe");
		await expect(uploadFiles("build", [file])).rejects.toThrow(
			"no artifact service; workflow artifacts can only be uploaded by the rylease action in a GitHub Actions job",
		);
		const payload = Buffer.from(JSON.stringify({ scp: "other" })).toString(
			"base64url",
		);
		vi.stubEnv("ACTIONS_RESULTS_URL", `${fake.base}/`);
		vi.stubEnv("ACTIONS_RUNTIME_TOKEN", `h.${payload}.s`);
		await expect(uploadFiles("build", [file])).rejects.toThrow(
			"the runtime token names no job",
		);
	});
});
