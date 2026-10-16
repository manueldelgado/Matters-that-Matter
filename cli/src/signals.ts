// Ctrl-C and `kill` while writing. Without a handler, the system stops the process wherever it is, which can be in
// the middle of a write: some notes changed, others not, temporary files left. Writes are synchronous, so a handler
// in JavaScript runs only once the write in progress, and its undo if it failed, has finished; it then ends the
// process with the usual code (128 plus the signal's number).

/** The part of `process` this needs, so tests can pass their own. */
export interface SignalTarget {
	on(signal: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
	exit(code: number): never | void;
}

const CODES = { SIGINT: 130, SIGTERM: 143 } as const;

let installed = false;

/** Lets a signal end the process only between writes, never in the middle of one. Installed once. */
export function finishWritesOnSignal(target: SignalTarget = process): void {
	if (installed && target === process) return;
	if (target === process) installed = true;
	for (const signal of ['SIGINT', 'SIGTERM'] as const) target.on(signal, () => target.exit(CODES[signal]));
}
