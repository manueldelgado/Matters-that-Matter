// Output to a pipe that closes early, as in `mtm list --json | head -c 10`: the rest of the output is dropped quietly
// instead of ending in a stack trace. Writes to the vault always finish before their report is printed, so a closed
// pipe never leaves one half done; the exit code stays the command's own.

/** What is needed of an output stream (Node's `process.stdout` and `process.stderr` have it). */
export interface ErrorSource {
	on(event: 'error', listener: (e: Error & { code?: string }) => void): unknown;
}

/** Errors that only mean the reader has gone: the pipe closed, or the stream was closed after it did. */
export const isClosedPipe = (e: { code?: string }): boolean => e.code === 'EPIPE' || e.code === 'ERR_STREAM_DESTROYED';

/** Ignores a closed pipe on the stream; any other error is thrown, as it would be without a listener. */
export function quietOnClosedPipe(stream: ErrorSource): void {
	stream.on('error', (e) => {
		if (!isClosedPipe(e)) throw e;
	});
}
