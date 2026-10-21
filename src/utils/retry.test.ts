import { clock, retry, waitFor } from "./retry.ts";

beforeEach(() => {
	vi.spyOn(clock, "sleep").mockResolvedValue();
});

afterEach(() => {
	vi.restoreAllMocks();
});

/** Fails `failures` times, then resolves with the attempt. */
const flaky = (failures: number) =>
	vi.fn(async (attempt: number) => {
		if (attempt <= failures) throw new Error(`failure ${attempt}`);
		return attempt;
	});

describe("retry", () => {
	it("retries until it resolves, waiting longer each time", async () => {
		expect(await retry(flaky(2), { attempts: 3 })).toBe(3);
		expect(vi.mocked(clock.sleep).mock.calls).toEqual([[1000], [2000]]);
	});

	it("rejects with the last error after its attempts", async () => {
		const run = flaky(5);
		await expect(retry(run, { attempts: 3 })).rejects.toThrow("failure 3");
		expect(run).toHaveBeenCalledTimes(3);
	});

	it("only retries errors that are worth it", async () => {
		const run = flaky(5);
		await expect(
			retry(run, {
				attempts: 5,
				retryIf: (error) => (error as Error).message !== "failure 2",
			}),
		).rejects.toThrow("failure 2");
		expect(run).toHaveBeenCalledTimes(2);
	});

	it("takes custom delays", async () => {
		await retry(flaky(2), { attempts: 3, delayMs: () => 5 });
		expect(vi.mocked(clock.sleep).mock.calls).toEqual([[5], [5]]);
	});
});

describe("waitFor", () => {
	it("polls until there's a value", async () => {
		const values = [undefined, undefined, "found"];
		expect(await waitFor(async () => values.shift(), { attempts: 5 })).toBe(
			"found",
		);
		expect(clock.sleep).toHaveBeenCalledTimes(2);
	});

	it("resolves with undefined if there never is", async () => {
		expect(await waitFor(async () => undefined, { attempts: 3 })).toBe(
			undefined,
		);
		expect(clock.sleep).toHaveBeenCalledTimes(2);
	});

	it("rejects at once with other errors", async () => {
		await expect(
			waitFor(
				async () => {
					throw new Error("broken");
				},
				{ attempts: 3 },
			),
		).rejects.toThrow("broken");
		expect(clock.sleep).not.toHaveBeenCalled();
	});
});

describe("clock", () => {
	it("sleeps for real", async () => {
		vi.restoreAllMocks();
		vi.useFakeTimers();
		try {
			let done = false;
			const sleeping = clock.sleep(1000).then(() => {
				done = true;
			});
			await vi.advanceTimersByTimeAsync(999);
			expect(done).toBe(false);
			await vi.advanceTimersByTimeAsync(1);
			await sleeping;
			expect(done).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});
});
