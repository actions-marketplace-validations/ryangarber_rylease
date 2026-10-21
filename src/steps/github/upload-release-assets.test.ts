import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	assetsOf,
	github,
	releaseGiven,
	useArtifactService,
	useFakeGitHub,
} from "../../testing/github.ts";
import { unzip } from "../../testing/unzip.ts";
import { githubCreateRelease } from "./create-release.ts";
import { githubUploadReleaseAssets } from "./upload-release-assets.ts";

const fake = useFakeGitHub();

describe("github/upload-release-assets", () => {
	it("creates the release, with the notes, when there's none yet", async () => {
		const report = await releaseGiven(fake, [
			githubUploadReleaseAssets({ files: ["dist/app*"] }),
		]);
		expect(report.status).toBe("released");
		expect(report.records[0]?.reason).toBe(
			"uploaded app.linux (5 B) and app.exe (7 B) to new release v1.2.0: https://github.com/me/demo/releases/tag/v1.2.0",
		);
		expect(report.releases[0]?.output).toEqual({
			repo: "me/demo",
			tag: "v1.2.0",
			url: "https://github.com/me/demo/releases/tag/v1.2.0",
			assets: [
				{
					name: "app.linux",
					size: 5,
					url: "https://github.com/download/app.linux",
				},
				{
					name: "app.exe",
					size: 7,
					url: "https://github.com/download/app.exe",
				},
			],
		});
		expect(github.releases).toMatchObject([
			{ tag_name: "v1.2.0", body: "Notes." },
		]);
		expect(assetsOf("v1.2.0")).toEqual(["app.linux=linux", "app.exe=windows"]);
	});

	it("uploads to an existing release, replacing assets of the same name", async () => {
		await releaseGiven(fake, [githubCreateRelease()]);
		await releaseGiven(fake, [
			githubUploadReleaseAssets({ files: ["dist/app.exe"] }),
		]);
		await writeFile(join(fake.cwd, "dist", "app.exe"), "windows 2");
		const report = await releaseGiven(fake, [
			githubUploadReleaseAssets({ files: ["dist/app.exe", "dist/nested"] }),
		]);
		expect(report.records[0]?.reason).toMatch(/to existing release v1\.2\.0/);
		expect(github.releases).toHaveLength(1);
		expect(assetsOf("v1.2.0")).toEqual(["app.exe=windows 2", "latest.json={}"]);
	});

	it("can refuse to replace assets", async () => {
		await releaseGiven(fake, [
			githubUploadReleaseAssets({ files: ["dist/app.exe"] }),
		]);
		await expect(
			releaseGiven(fake, [
				githubUploadReleaseAssets({ files: ["dist/app.exe"], clobber: false }),
			]),
		).rejects.toThrow(
			"release v1.2.0 already has app.exe; set clobber to replace it",
		);
	});

	it("fails on a pattern that matches nothing, even in a dry run", async () => {
		await expect(
			releaseGiven(
				fake,
				[githubUploadReleaseAssets({ files: ["dist/app.exe", "dist/*.dmg"] })],
				true,
			),
		).rejects.toThrow("no files match 'dist/*.dmg'");
	});

	it("only says what it would upload in a dry run", async () => {
		const report = await releaseGiven(
			fake,
			[
				githubUploadReleaseAssets({
					files: ["dist/app.exe"],
				}),
			],
			true,
			"{version}",
		);
		expect(report.records[0]?.reason).toBe(
			"would upload app.exe (7 B) to release 1.2.0 on me/demo",
		);
		expect(github.requests).toEqual([]);
	});

	it("can keep the files as an artifact in a dry run", async () => {
		useArtifactService(fake);
		const report = await releaseGiven(
			fake,
			[
				githubUploadReleaseAssets({
					files: ["dist/app*"],
					dryRunArtifact: true,
				}),
			],
			true,
		);
		expect(report.records[0]?.reason).toMatch(
			/^would upload app\.linux \(5 B\) and app\.exe \(7 B\) to release v1\.2\.0 on me\/demo; kept them as artifact release-assets-[0-9a-f]{8}$/,
		);
		expect(github.releases).toEqual([]);
		const [[name, artifact] = []] = [...github.artifacts];
		expect(await unzip(artifact?.content)).toEqual({
			"app linux": "linux",
			"app.exe": "windows",
		});
		expect(name).toMatch(/^release-assets-/);
	});

	it("names the artifact after a single asset, or as told", async () => {
		useArtifactService(fake);
		const keep = (artifactName?: string) =>
			releaseGiven(
				fake,
				[
					githubUploadReleaseAssets({
						files: ["dist/app linux"],
						dryRunArtifact: true,
						...(artifactName && { artifactName }),
					}),
				],
				true,
			);
		await keep();
		await keep("linux-{version}");
		expect([...github.artifacts.keys()]).toEqual(["app.linux", "linux-1.2.0"]);
	});

	it("skips the artifact outside GitHub Actions", async () => {
		const report = await releaseGiven(
			fake,
			[
				githubUploadReleaseAssets({
					files: ["dist/app.exe"],
					dryRunArtifact: true,
				}),
			],
			true,
		);
		expect(report.records[0]?.reason).toBe(
			"would upload app.exe (7 B) to release v1.2.0 on me/demo (no artifact app.exe outside GitHub Actions)",
		);
	});
});
