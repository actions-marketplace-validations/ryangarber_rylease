import { versionFormat } from "./formats.ts";

const none = new Map<string, string>();

describe("version formats", () => {
	it.each([
		["plain", "1.0.0\n", "2.0.0\n"],
		[
			"npm",
			'{\n  "name": "a",\n  "version": "1.0.0"\n}\n',
			'{\n  "name": "a",\n  "version": "2.0.0"\n}\n',
		],
		[
			"cargo",
			'[package]\nname = "app" # the binary\nversion = "1.0.0"\n\n[dependencies]\nserde = "1"\n',
			'[package]\nname = "app" # the binary\nversion = "2.0.0"\n\n[dependencies]\nserde = "1"\n',
		],
		[
			"python",
			"[build-system]\nrequires = ['hatchling']\n\n[project]\nname = 'app'\nversion = '1.0.0'\n",
			"[build-system]\nrequires = ['hatchling']\n\n[project]\nname = 'app'\nversion = '2.0.0'\n",
		],
		[
			"python",
			'[tool.poetry]\nname = "app"\nversion = "1.0.0"\n',
			'[tool.poetry]\nname = "app"\nversion = "2.0.0"\n',
		],
		[
			"helm",
			'apiVersion: v2\nname: app\nversion: 1.0.0 # chart\nappVersion: "1.0.0"\n',
			'apiVersion: v2\nname: app\nversion: 2.0.0 # chart\nappVersion: "1.0.0"\n',
		],
		["gradle", "group=com.x\nversion=1.0.0\n", "group=com.x\nversion=2.0.0\n"],
		[
			"dart",
			"name: app\n# the package's\nversion: 1.0.0 # released\n\nenvironment:\n  sdk: ^3.6.0\n",
			"name: app\n# the package's\nversion: 2.0.0 # released\n\nenvironment:\n  sdk: ^3.6.0\n",
		],
		[
			"ruby",
			'module App\n  VERSION = "1.0.0".freeze\nend\n',
			'module App\n  VERSION = "2.0.0".freeze\nend\n',
		],
		[
			"dotnet",
			'<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <Version>1.0.0</Version>\n  </PropertyGroup>\n  <ItemGroup>\n    <PackageReference Include="X">\n      <Version>3.0.0</Version>\n    </PackageReference>\n  </ItemGroup>\n</Project>\n',
			'<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <Version>2.0.0</Version>\n  </PropertyGroup>\n  <ItemGroup>\n    <PackageReference Include="X">\n      <Version>3.0.0</Version>\n    </PackageReference>\n  </ItemGroup>\n</Project>\n',
		],
		[
			"maven",
			'<?xml version="1.0"?>\n<project>\n  <parent>\n    <version>9.9.9</version>\n  </parent>\n  <!-- <version>0</version> -->\n  <artifactId>app</artifactId>\n  <version>1.0.0</version>\n  <dependencies><dependency><version>3.0</version></dependency></dependencies>\n</project>\n',
			'<?xml version="1.0"?>\n<project>\n  <parent>\n    <version>9.9.9</version>\n  </parent>\n  <!-- <version>0</version> -->\n  <artifactId>app</artifactId>\n  <version>2.0.0</version>\n  <dependencies><dependency><version>3.0</version></dependency></dependencies>\n</project>\n',
		],
	] as const)(
		"reads and writes %s, keeping the rest",
		(name, before, after) => {
			const format = versionFormat(name);
			expect(format.read(before)).toBe("1.0.0");
			expect(format.write(before, "2.0.0", none).text).toBe(after);
			expect(format.read(after)).toBe("2.0.0");
		},
	);

	it("writes wherever a pattern matches", () => {
		const format = versionFormat("pattern", '__version__ = "{version}"');
		const text = '__version__ = "1.0.0"\nother = "x"\n__version__ = "1.0.0"\n';
		expect(format.read(text)).toBe("1.0.0");
		expect(format.write(text, "1.1.0", none).text).toBe(
			'__version__ = "1.1.0"\nother = "x"\n__version__ = "1.1.0"\n',
		);
		expect(() => format.write("nothing", "1.1.0", none)).toThrow(
			`nothing matches '__version__ = "{version}"'`,
		);
		expect(() => versionFormat("pattern", "VERSION")).toThrow(
			"the pattern 'VERSION' has no {version} placeholder",
		);
	});

	it("points cargo dependencies on released crates at them", () => {
		const cargo = versionFormat("cargo");
		const text =
			'[package]\nname = "cli"\nversion = "1.0.0"\n\n[dependencies]\ncore = { path = "../core", version = "^1.0.0" }\nserde = { version = "1" }\n';
		expect(cargo.packageName?.(text)).toBe("cli");
		expect(cargo.write(text, "1.0.1", new Map([["core", "2.0.0"]]))).toEqual({
			text: '[package]\nname = "cli"\nversion = "1.0.1"\n\n[dependencies]\ncore = { path = "../core", version = "^2.0.0" }\nserde = { version = "1" }\n',
			dependencies: ["core@^2.0.0"],
		});
	});

	it("increments a dart build number, which isn't part of the release", () => {
		const dart = versionFormat("dart");
		const text = "name: app\nversion: '1.0.0+41'\n";
		expect(dart.read(text)).toBe("1.0.0");
		expect(dart.write(text, "1.1.0", none)).toEqual({
			text: "name: app\nversion: '1.1.0+42'\n",
			dependencies: [],
			version: "1.1.0+42",
		});
		// A version with its own build metadata is written as it is.
		expect(dart.write(text, "1.1.0+nightly.3", none).version).toBe(
			"1.1.0+nightly.3",
		);
		expect(dart.read("name: app\nversion: 1.0.0+build.1\n")).toBe(
			"1.0.0+build.1",
		);
		expect(() => dart.write("name: app\n", "1.1.0", none)).toThrow(
			"it has no version",
		);
	});

	it("points dart dependencies on released packages at them", () => {
		const dart = versionFormat("dart");
		const text = [
			"name: cli",
			"version: 1.0.0",
			"",
			"environment:",
			"  core: ^1.0.0 # not a dependency",
			"",
			"dependencies:",
			"  flutter:",
			"    sdk: flutter",
			"  core: ^1.0.0 # ours",
			'  "models": ">=1.0.0 <2.0.0"',
			"  utils: any",
			"  hosted_one:",
			"    hosted: https://pub.example.com",
			"    version: '~1.0.0'",
			"  local:",
			"    path: ../local",
			"",
			"dev_dependencies:",
			"    # indented further than most",
			"    core: 1.0.0",
			"",
			"dependency_overrides:",
			"  core:",
			"    path: ../core",
			"",
		].join("\n");
		const packages = new Map([
			["cli", "1.0.1"],
			["core", "2.0.0"],
			["models", "2.0.0"],
			["utils", "2.0.0"],
			["hosted_one", "1.1.0"],
			["local", "3.0.0"],
		]);
		expect(dart.packageName?.(text)).toBe("cli");
		const { text: written, dependencies } = dart.write(text, "1.0.1", packages);
		expect(written).toBe(
			text
				.replace("version: 1.0.0", "version: 1.0.1")
				.replace("core: ^1.0.0 # ours", "core: ^2.0.0 # ours")
				.replace("version: '~1.0.0'", "version: '~1.1.0'")
				.replace("    core: 1.0.0", "    core: 2.0.0"),
		);
		expect(dependencies).toEqual([
			"core@^2.0.0",
			"hosted_one@~1.1.0",
			"core@2.0.0",
		]);
	});

	it("reads nothing where there's no version", () => {
		expect(versionFormat("npm").read("not json")).toBeUndefined();
		expect(
			versionFormat("cargo").read('[workspace]\nversion = "1"\n'),
		).toBeUndefined();
		expect(versionFormat("maven").read("<project></project>")).toBeUndefined();
	});
});
