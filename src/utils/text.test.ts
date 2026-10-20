import { joinList, plural } from "./text.ts";

describe("plural", () => {
	it.each([
		[0, "0 files"],
		[1, "1 file"],
		[2, "2 files"],
	])("%i → %s", (count, text) => {
		expect(plural(count, "file")).toBe(text);
	});

	it("takes an irregular plural", () => {
		expect(plural(2, "entry", "entries")).toBe("2 entries");
	});
});

describe("joinList", () => {
	it.each([
		[[], ""],
		[["a"], "a"],
		[["a", "b"], "a and b"],
		[["a", "b", "c"], "a, b and c"],
	])("%o → %o", (parts, text) => {
		expect(joinList(parts)).toBe(text);
	});
});
