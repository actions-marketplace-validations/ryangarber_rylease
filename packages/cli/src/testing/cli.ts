import { cli } from "../main.ts";

/** Runs the CLI in `cwd`, collecting what it writes. */
export async function runCli(cwd: string, ...argv: string[]) {
	let out = "";
	let err = "";
	const code = await cli(argv, {
		cwd,
		write: (text) => {
			out += text;
		},
		error: (text) => {
			err += text;
		},
	});
	return { code, out, err };
}
