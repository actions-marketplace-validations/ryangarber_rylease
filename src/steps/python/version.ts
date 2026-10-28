const PRE: Record<string, string> = { alpha: "a", beta: "b", c: "rc" };

const PEP440 =
	/^v?(\d+(?:\.\d+)*)(?:[-_.]?(alpha|a|beta|b|preview|pre|c|rc)[-_.]?(\d*))?(?:-(\d+)|[-_.]?(?:post|rev|r)[-_.]?(\d*))?(?:[-_.]?dev[-_.]?(\d*))?(?:\+([a-z0-9]+(?:[-_.][a-z0-9]+)*))?$/;

/**
 * A version as PEP 440 normalizes it, e.g. `1.0.0-RC.1` as `1.0.0rc1` and
 * `2026.01.0` as `2026.1.0`, so semantic versions compare with Python's;
 * one it doesn't allow, like `1.0.0-next.1`, is only lowercased.
 */
export function normalizePython(version: string): string {
	const lower = version.trim().toLowerCase();
	const match = PEP440.exec(lower);
	if (!match) return lower;
	const [, release = "", pre, preN, postImplicit, post, dev, local] = match;
	const number = (n: string | undefined) => String(Number(n || 0));
	return [
		release.split(".").map(number).join("."),
		pre === undefined
			? ""
			: `${PRE[pre] ?? (pre.startsWith("pre") ? "rc" : pre)}${number(preN)}`,
		postImplicit !== undefined || post !== undefined
			? `.post${number(postImplicit ?? post)}`
			: "",
		dev === undefined ? "" : `.dev${number(dev)}`,
		local === undefined ? "" : `+${local.replace(/[-_]/g, ".")}`,
	].join("");
}
