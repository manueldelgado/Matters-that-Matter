// mtm-waiting-since follows observed changes of mtm-waiting-on only; it is never backfilled.

export type SinceChange = 'set' | 'remove' | 'none';

/**
 * What an observed change of mtm-waiting-on does to mtm-waiting-since.
 * Keys identify the person (resolved path or link text); null means absent, undefined means not seen before.
 * A new person (from absent or another one) sets today, unless the same edit set the date itself;
 * removing the person removes the date.
 */
export function waitingSinceChange(
	previousKey: string | null | undefined,
	nextKey: string | null,
	hasSince: boolean,
	sinceEdited: boolean,
): SinceChange {
	if (previousKey === undefined || previousKey === nextKey) return 'none';
	if (nextKey === null) return hasSince ? 'remove' : 'none';
	if (sinceEdited && hasSince) return 'none';
	return 'set';
}

/** For writes the plugin makes itself: the date follows the person in the same write. */
export function applyWaitingSince(fm: Record<string, unknown>, previousKey: string | null, nextKey: string | null, today: string): void {
	if (previousKey === nextKey) return;
	if (nextKey === null) delete fm['mtm-waiting-since'];
	else fm['mtm-waiting-since'] = today;
}

/** The last waiting-on person and waiting-since value seen for each Action path. */
export class WaitingCache {
	private seen = new Map<string, { key: string | null; since: unknown }>();

	/** Records the values without judging a change (on load). */
	seed(path: string, key: string | null, since: unknown): void {
		this.seen.set(path, { key, since });
	}

	/** Records a metadata change and returns what to do with mtm-waiting-since. */
	observe(path: string, key: string | null, since: unknown, hasSince: boolean): SinceChange {
		const previous = this.seen.get(path);
		this.seen.set(path, { key, since });
		if (!previous) return 'none';
		return waitingSinceChange(previous.key, key, hasSince, previous.since !== since);
	}

	rename(oldPath: string, newPath: string): void {
		const entry = this.seen.get(oldPath);
		this.seen.delete(oldPath);
		if (entry) this.seen.set(newPath, entry);
	}

	forget(path: string): void {
		this.seen.delete(path);
	}

	clear(): void {
		this.seen.clear();
	}
}
