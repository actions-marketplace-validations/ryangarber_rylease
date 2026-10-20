import { unzip } from "../testing/unzip.ts";
import { zip } from "./zip.ts";

describe("zip", () => {
	it("makes an archive that unzip reads back", async () => {
		const archive = await zip([
			{ name: "a.txt", content: Buffer.from("a".repeat(1000)) },
			{ name: "dir\\some name.json", content: Buffer.from("{}") },
			{ name: "empty", content: new Uint8Array() },
		]);
		expect(await unzip(archive)).toEqual({
			"a.txt": "a".repeat(1000),
			"dir/some name.json": "{}",
			empty: "",
		});
	});

	it("marks names as UTF-8", async () => {
		// macOS's unzip ignores the flag, so read the local header instead.
		const archive = await zip([{ name: "ünï.txt", content: Buffer.from("") }]);
		expect(archive.readUInt32LE(0)).toBe(0x04034b50);
		expect(archive.readUInt16LE(6) & 0x0800).toBe(0x0800);
		const length = archive.readUInt16LE(26);
		expect(archive.subarray(30, 30 + length).toString("utf8")).toBe("ünï.txt");
	});

	it("makes an empty archive", async () => {
		const archive = await zip([]);
		// Just the end of central directory record.
		expect(archive).toHaveLength(22);
		expect(archive.readUInt32LE(0)).toBe(0x06054b50);
	});
});
