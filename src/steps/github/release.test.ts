import { assetsOf, github, useFakeGitHub } from "../../testing/github.ts";
import { clock } from "../../utils/retry.ts";
import { githubClient } from "./api.ts";
import {
	assetName,
	ensureRelease,
	type NewRelease,
	releaseRepo,
	uploadAsset,
} from "./release.ts";

const fake = useFakeGitHub();

const client = () => githubClient("me/demo", "token");

const v1: NewRelease = {
	tag: "v1.0.0",
	target: "abc1234",
	title: "Version 1",
	notes: "Notes.",
	draft: false,
	prerelease: true,
};

describe("ensureRelease", () => {
	it("creates the release when the tag has none", async () => {
		const { release, created } = await ensureRelease(client(), v1);
		expect(created).toBe(true);
		expect(release.html_url).toBe(
			"https://github.com/me/demo/releases/tag/v1.0.0",
		);
		expect(github.releases).toMatchObject([
			{
				tag_name: "v1.0.0",
				target_commitish: "abc1234",
				name: "Version 1",
				body: "Notes.",
				draft: false,
				prerelease: true,
			},
		]);
	});

	it("finds an existing release, drafts included", async () => {
		const first = await ensureRelease(client(), { ...v1, draft: true });
		const again = await ensureRelease(client(), v1);
		expect(again).toEqual({ release: first.release, created: false });
		expect(github.releases).toHaveLength(1);
		// Drafts have no tag yet, so only the listing finds them.
		expect(github.requests.slice(-2)).toEqual([
			"GET /repos/me/demo/releases/tags/v1.0.0",
			"GET /repos/me/demo/releases",
		]);
	});

	it("uses the release another job created at the same time", async () => {
		github.raceCreate = true;
		const { created } = await ensureRelease(client(), v1);
		expect(created).toBe(false);
		expect(github.releases).toHaveLength(1);
	});

	it("fails on other errors", async () => {
		await expect(
			ensureRelease(githubClient("me/other", "token"), v1),
		).rejects.toThrow("GitHub responded 404 to GET");
	});
});

describe("uploadAsset", () => {
	const upload = async (content: string, clobber = true) => {
		const { release } = await ensureRelease(client(), v1);
		return uploadAsset(
			client(),
			release,
			{ name: "app linux", content: Buffer.from(content) },
			clobber,
		);
	};

	it("uploads under GitHub's name for the file", async () => {
		const asset = await upload("linux");
		expect(asset).toMatchObject({
			name: "app.linux",
			size: 5,
			browser_download_url: "https://github.com/download/app.linux",
		});
		expect(assetsOf("v1.0.0")).toEqual(["app.linux=linux"]);
	});

	it("replaces an asset of the same name, unless told not to", async () => {
		await upload("linux");
		await upload("linux 2");
		expect(assetsOf("v1.0.0")).toEqual(["app.linux=linux 2"]);
		await expect(upload("linux 3", false)).rejects.toThrow(
			"release v1.0.0 already has app.linux; set clobber to replace it",
		);
	});

	it("retries failed uploads, clearing what they left", async () => {
		github.failUploads = 2;
		await upload("linux");
		expect(assetsOf("v1.0.0")).toEqual(["app.linux=linux"]);
		expect(clock.sleep).toHaveBeenCalledTimes(2);
	});
});

describe("assetName", () => {
	it.each([
		["app.exe", "app.exe"],
		["My App.zip", "My.App.zip"],
		["a+b@c~d-e_f", "a+b@c~d-e_f"],
		["ünï (1).tar.gz", ".n...1..tar.gz"],
	])("%s → %s", (file, name) => {
		expect(assetName(file)).toBe(name);
	});
});

describe("releaseRepo", () => {
	it("takes the option, then the repository being released", async () => {
		expect(await releaseRepo(fake.cwd, "a/b")).toBe("a/b");
		expect(await releaseRepo(fake.cwd, undefined)).toBe("me/demo");
	});

	it("fails without either", async () => {
		vi.stubEnv("GITHUB_REPOSITORY", "");
		await expect(releaseRepo(fake.cwd, undefined)).rejects.toThrow(
			"couldn't determine the GitHub repository",
		);
	});
});
