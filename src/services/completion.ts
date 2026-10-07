// mtm-completed follows observed status transitions only; it is never backfilled.

import type { StatusCategory } from '../settings';

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

/** The last category seen for each Action path. */
export class StatusCache {
	private categories = new Map<string, StatusCategory>();

	/** Records a category without judging a transition (on load, and after the plugin's own writes). */
	seed(path: string, category: StatusCategory): void {
		this.categories.set(path, category);
	}

	get(path: string): StatusCategory | undefined {
		return this.categories.get(path);
	}

	/** Records a metadata change and returns what to do with mtm-completed. */
	observe(path: string, category: StatusCategory, hasCompleted: boolean): CompletionChange {
		const change = completionChange(this.categories.get(path), category, hasCompleted);
		this.categories.set(path, category);
		return change;
	}

	rename(oldPath: string, newPath: string): void {
		const category = this.categories.get(oldPath);
		this.categories.delete(oldPath);
		if (category !== undefined) this.categories.set(newPath, category);
	}

	forget(path: string): void {
		this.categories.delete(path);
	}

	clear(): void {
		this.categories.clear();
	}
}
