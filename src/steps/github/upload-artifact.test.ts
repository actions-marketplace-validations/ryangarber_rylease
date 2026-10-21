import {
	github,
	releaseGiven,
	useArtifactService,
	useFakeGitHub,
} from "../../testing/github.ts";
import { unzip } from "../../testing/unzip.ts";
import { githubUploadArtifact } from "./upload-artifact.ts";

const fake = useFakeGitHub();

describe("github/upload-artifact", () => {
	it("uploads files, globs and directories as a zip", async () => {
		useArtifactService(fake);
		const report = await releaseGiven(fake, [
			githubUploadArtifact({
				name: "build-{version}",
				files: ["dist/*.exe", "dist/nested"],
			}),
		]);
		expect(report.records[0]?.reason).toBe(
			"uploaded 2 files (9 B) as artifact build-1.2.0",
		);
		expect(report.releases[0]?.output).toEqual({
			name: "build-1.2.0",
			id: "42",
			files: ["app.exe", "nested/latest.json"],
		});
		expect(await unzip(github.artifacts.get("build-1.2.0")?.content)).toEqual({
			"app.exe": "windows",
			"nested/latest.json": "{}",
		});
	});

	it("uploads in dry runs only with dryRunArtifact", async () => {
		useArtifactService(fake);
		const step = (dryRunArtifact: boolean) =>
			githubUploadArtifact({
				name: "build",
				files: ["dist/app.exe"],
				dryRunArtifact,
			});
		expect(
			(await releaseGiven(fake, [step(false)], true)).records[0]?.reason,
		).toBe("would upload 1 file as artifact build");
		expect(github.artifacts.size).toBe(0);
		await releaseGiven(fake, [step(true)], true);
		expect(github.artifacts.get("build")?.hash).toMatch(/^sha256:/);
	});

	it("says why it can't upload in a dry run outside GitHub Actions", async () => {
		const report = await releaseGiven(
			fake,
			[
				githubUploadArtifact({
					name: "build",
					files: ["dist/app.exe"],
					dryRunArtifact: true,
				}),
			],
			true,
		);
		expect(report.records[0]?.reason).toBe(
			"would upload 1 file as artifact build (outside GitHub Actions)",
		);
	});

	it("fails outside GitHub Actions", async () => {
		await expect(
			releaseGiven(fake, [
				githubUploadArtifact({ name: "build", files: ["dist/app.exe"] }),
			]),
		).rejects.toThrow("no artifact service");
	});

	it("requires a name and files", () => {
		expect(() => githubUploadArtifact({ name: "x", files: [] })).toThrow(
			"github/upload-artifact.files: Too small",
		);
	});
});
