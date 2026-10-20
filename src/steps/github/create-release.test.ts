import { github, releaseGiven, useFakeGitHub } from "../../testing/github.ts";
import { git } from "../../utils/git.ts";
import { githubCreateRelease } from "./create-release.ts";

const fake = useFakeGitHub();

describe("github/create-release", () => {
	it("creates a release at HEAD with the notes", async () => {
		const report = await releaseGiven(
			fake,
			[
				githubCreateRelease({
					title: "Demo {version}",
					prerelease: true,
				}),
			],
			false,
			"release-{version}",
		);
		const url = "https://github.com/me/demo/releases/tag/release-1.2.0";
		expect(report.records[0]?.reason).toBe(
			`created release release-1.2.0: ${url}`,
		);
		expect(report.releases[0]?.output).toEqual({
			repo: "me/demo",
			tag: "release-1.2.0",
			id: github.releases[0]?.id,
			url,
		});
		expect(github.releases).toMatchObject([
			{
				tag_name: "release-1.2.0",
				name: "Demo 1.2.0",
				target_commitish: await git(fake.cwd, "rev-parse", "HEAD"),
				body: "Notes.",
				draft: false,
				prerelease: true,
			},
		]);
	});

	it("titles the release with its tag by default", async () => {
		await releaseGiven(fake, [githubCreateRelease()]);
		expect(github.releases).toMatchObject([{ name: "v1.2.0" }]);
	});

	it("finds the release another job created", async () => {
		await releaseGiven(fake, [githubCreateRelease()]);
		const report = await releaseGiven(fake, [githubCreateRelease()]);
		expect(report.records[0]?.reason).toBe(
			"found existing release v1.2.0: https://github.com/me/demo/releases/tag/v1.2.0",
		);
		expect(github.releases).toHaveLength(1);
	});

	it("only says what it would create in a dry run", async () => {
		const report = await releaseGiven(
			fake,
			[githubCreateRelease({ repo: "you/other" })],
			true,
		);
		expect(report.records[0]?.reason).toBe(
			"would create release v1.2.0 on you/other",
		);
		expect(github.requests).toEqual([]);
	});

	it("needs a token", async () => {
		vi.stubEnv("GITHUB_TOKEN", "");
		vi.stubEnv("GH_TOKEN", "");
		await expect(releaseGiven(fake, [githubCreateRelease()])).rejects.toThrow(
			"no token; set GITHUB_TOKEN or GH_TOKEN",
		);
		expect(
			(await releaseGiven(fake, [githubCreateRelease({ token: "t" })])).status,
		).toBe("released");
	});
});
