// mtm-completed follows observed status transitions only; it is never backfilled.

import type { StatusCategory, StatusDef } from '../settings';

export type CompletionChange = 'set' | 'remove' | 'none';

/**
 * Entering closed sets the date if absent; leaving closed removes it.
 * Without a known previous category there is no observed transition.
 */
export function completionChange(
	previous: StatusCategory | undefined,
	next: StatusCategory,
	hasCompleted: boolean,
): CompletionChange {
	if (previous === undefined || previous === next) return 'none';
	if (next === 'closed' && previous !== 'closed') return hasCompleted ? 'none' : 'set';
	if (previous === 'closed' && next !== 'closed') return hasCompleted ? 'remove' : 'none';
	return 'none';
}

const hasValue = (raw: unknown) => raw !== undefined && raw !== null && !(typeof raw === 'string' && raw.trim() === '');

/**
 * Writes a status the plugin sets itself, with mtm-completed following the transition.
 * `previous` is the category before the change (undefined when unknown: nothing changes).
 */
export function applyStatus(
	fm: Record<string, unknown>,
	next: StatusDef,
	previous: StatusCategory | undefined,
	today: string,
): void {
	fm['mtm-status'] = next.id;
	const change = completionChange(previous, next.category, hasValue(fm['mtm-completed']));
	if (change === 'set') fm['mtm-completed'] = today;
	else if (change === 'remove') delete fm['mtm-completed'];
}

/** The last status seen for each Action path: raw value and effective category. */
export class StatusCache {
	private seen = new Map<string, { raw: unknown; category: StatusCategory }>();

	/** Records a status without judging a transition (on load, and when settings change). */
	seed(path: string, raw: unknown, category: StatusCategory): void {
		this.seen.set(path, { raw, category });
	}

	get(path: string): StatusCategory | undefined {
		return this.seen.get(path)?.category;
	}

	/**
	 * Records a metadata change and returns what to do with mtm-completed.
	 * Only a change of the raw status counts: a category edited in settings is not a transition.
	 */
	observe(path: string, raw: unknown, category: StatusCategory, hasCompleted: boolean): CompletionChange {
		const previous = this.seen.get(path);
		this.seen.set(path, { raw, category });
		if (!previous || previous.raw === raw) return 'none';
		return completionChange(previous.category, category, hasCompleted);
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

export { hasValue as hasCompletedValue };
