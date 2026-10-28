import { errorMessage, OptionsError } from "rylease";

export interface Io {
	cwd: string;
	write: (text: string) => void;
	error: (text: string) => void;
	/** Whether someone's there to answer prompts and watch progress. */
	interactive?: boolean;
}

/** An error in what the CLI was given, reported as `rylease: ...` lines. */
export function issuesOf(error: unknown): readonly string[] {
	return error instanceof OptionsError ? error.issues : [errorMessage(error)];
}
