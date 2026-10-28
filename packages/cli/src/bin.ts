#!/usr/bin/env node
import { run } from "./index.ts";

void run(process.argv.slice(2)).then((code) => {
	process.exitCode = code;
});
