// Process Inbox: the queue, the statuses each step offers, and the tally at the end. Pure.

import type { StatusDef } from '../settings';

export type Decision = 'trash' | 'note' | 'someday' | 'done' | 'delegate' | 'next' | 'matter';

/** In the order of the question; keys 1–7 follow it. */
export const DECISIONS: readonly Decision[] = ['trash', 'note', 'someday', 'done', 'delegate', 'next', 'matter'];
export const NOT_ACTIONABLE: readonly Decision[] = ['trash', 'note', 'someday'];
export const ACTIONABLE: readonly Decision[] = ['done', 'delegate', 'next', 'matter'];

/** Oldest capture first (file creation time), then by title. */
export function inboxOrder<T extends { title: string; ctime: number }>(items: readonly T[]): T[] {
	return [...items].sort((a, b) => a.ctime - b.ctime || a.title.localeCompare(b.title));
}

/** Do next: the open and active statuses that are not the backlog, in workflow order. */
export function nextStatuses(statuses: readonly StatusDef[]): StatusDef[] {
	return statuses.filter((s) => s.category !== 'closed' && !s.backlog);
}

/** Delegate: the status chosen last time if it still exists, else the last active status in workflow order. */
export function delegateStatus(statuses: readonly StatusDef[], lastId: string | null): StatusDef | null {
	const offered = nextStatuses(statuses);
	const last = lastId ? offered.find((s) => s.id === lastId) : undefined;
	return last ?? [...offered].reverse().find((s) => s.category === 'active') ?? offered[0] ?? null;
}

/** Every mtm- property removed: the note stops being an Action. */
export function stripMtmProperties(fm: Record<string, unknown>): void {
	for (const key of Object.keys(fm)) if (key.startsWith('mtm-')) delete fm[key];
}

/** A queue snapshot: skipped items stay; processed ones are passed over when moving. */
export class ProcessQueue<T = string> {
	private done = new Set<number>();
	index = 0;

	constructor(readonly paths: T[]) {}

	get total(): number {
		return this.paths.length;
	}

	get processed(): number {
		return this.done.size;
	}

	get current(): T | null {
		return this.paths[this.index] ?? null;
	}

	isDone(i: number): boolean {
		return this.done.has(i);
	}

	/** Marks the current item processed and moves to the next one still open after it (null at the end). */
	complete(): T | null {
		this.done.add(this.index);
		return this.forward();
	}

	/** Undo: the item counts as open again and becomes current. */
	reopen(i: number): void {
		this.done.delete(i);
		this.index = i;
	}

	/** The next open item after the current one; null past the end. */
	forward(): T | null {
		for (let i = this.index + 1; i < this.paths.length; i++) {
			if (!this.done.has(i)) {
				this.index = i;
				return this.paths[i] ?? null;
			}
		}
		this.index = this.paths.length;
		return null;
	}

	/** The previous open item; stays put at the start. */
	back(): T | null {
		for (let i = Math.min(this.index, this.paths.length) - 1; i >= 0; i--) {
			if (!this.done.has(i)) {
				this.index = i;
				return this.paths[i] ?? null;
			}
		}
		return this.current;
	}

	/** Items left open (skipped). */
	get left(): number {
		return this.paths.length - this.done.size;
	}
}

/** What went where, for the end of the session. */
export interface TallyEntry {
	decision: Decision;
	/** The status for Do next, the person for Delegate. */
	detail?: string;
}

export interface TallyLine {
	icon: string;
	decision: Decision;
	count: number;
	detail?: string;
}

const ICONS: Record<Decision, string> = {
	trash: 'trash-2',
	note: 'notebook-text',
	someday: 'cloud-moon',
	done: 'check',
	delegate: 'send',
	next: 'arrow-right-to-line',
	matter: 'layers',
};

export function decisionIcon(d: Decision): string {
	return ICONS[d];
}

/**
 * One line per decision, in a fixed order (done first). Do next is counted per status ("2 in Next");
 * Delegate names the person when everyone waited on is the same one.
 */
export function tally(entries: readonly TallyEntry[]): TallyLine[] {
	const order: Decision[] = ['done', 'next', 'delegate', 'matter', 'someday', 'note', 'trash'];
	const lines: TallyLine[] = [];
	for (const decision of order) {
		const mine = entries.filter((e) => e.decision === decision);
		if (!mine.length) continue;
		if (decision === 'next') {
			const by = new Map<string, number>();
			for (const e of mine) by.set(e.detail ?? '', (by.get(e.detail ?? '') ?? 0) + 1);
			for (const [detail, count] of by) lines.push({ icon: ICONS.next, decision, count, detail });
		} else if (decision === 'delegate') {
			const people = new Set(mine.map((e) => e.detail ?? ''));
			lines.push({ icon: ICONS.delegate, decision, count: mine.length, detail: people.size === 1 ? [...people][0] : undefined });
		} else {
			lines.push({ icon: ICONS[decision], decision, count: mine.length });
		}
	}
	return lines;
}
