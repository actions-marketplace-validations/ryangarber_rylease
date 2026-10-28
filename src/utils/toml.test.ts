import { tomlKey, tomlStrings, tomlValue } from "./toml.ts";

const text = [
	'name = "top"',
	"",
	"[package]",
	'name = "app" # the binary',
	"publish = false",
	"",
	"[[bin]]",
	'name = "other"',
	"",
	"[workspace]",
	"members = [",
	'  "crates/*", # all of them',
	"  'tools/x',",
	"]",
	'exclude = ["crates/#skip"]',
].join("\n");

describe("toml", () => {
	it("reads and writes a string in the first table that has it", () => {
		const name = tomlKey(["package"], "name");
		expect(name.read(text)).toBe("app");
		expect(name.write(text, "renamed")).toBe(
			text.replace('"app"', '"renamed"'),
		);
		expect(tomlKey(["bin"], "name").read(text)).toBeUndefined();
		expect(tomlKey(["nope"], "name").write(text, "x")).toBeUndefined();
	});

	it("reads raw values, arrays across lines, without comments", () => {
		expect(tomlValue(text, "package", "publish")).toBe("false");
		expect(tomlStrings(tomlValue(text, "workspace", "members"))).toEqual([
			"crates/*",
			"tools/x",
		]);
		expect(tomlStrings(tomlValue(text, "workspace", "exclude"))).toEqual([
			"crates/#skip",
		]);
		expect(tomlValue(text, "workspace", "nope")).toBeUndefined();
		expect(tomlStrings(undefined)).toEqual([]);
	});
});
