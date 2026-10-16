// The `matters-that-matter` executable: runs the command line with the process's arguments, streams and environment.

import { homedir } from 'node:os';
import { run } from './main';
import { quietOnClosedPipe } from './pipes';
import { finishWritesOnSignal } from './signals';

quietOnClosedPipe(process.stdout);
quietOnClosedPipe(process.stderr);
// A signal waits for a write in progress to be done (or put back), then ends the process.
finishWritesOnSignal();

run(process.argv.slice(2), {
	stdout: process.stdout,
	stderr: process.stderr,
	env: process.env,
	cwd: process.cwd(),
	home: homedir(),
}).then(
	(code) => {
		process.exitCode = code;
		// One more turn, so a signal that came during a write ends the process with its own code.
		setImmediate(() => undefined);
	},
	(e: unknown) => {
		process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
		process.exitCode = 1;
	},
);
