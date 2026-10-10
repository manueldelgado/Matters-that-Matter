// The `mtm` executable: runs the command line with the process's arguments, streams and environment.

import { homedir } from 'node:os';
import { run } from './main';

run(process.argv.slice(2), {
	stdout: process.stdout,
	stderr: process.stderr,
	env: process.env,
	cwd: process.cwd(),
	home: homedir(),
}).then(
	(code) => {
		process.exitCode = code;
	},
	(e: unknown) => {
		process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
		process.exitCode = 1;
	},
);
