// What the banner on a person note shows: open Actions that name them, waiting first. Pure.

import { compareCards, isToday } from '../model/actions';
import { parseMtmDate, type Ymd } from '../model/dates';
import type { ActionItem } from './actionItems';

/** An Action that names the person, and whether it names them in mtm-waiting-on. */
export interface PersonEntry {
	item: ActionItem;
	waiting: boolean;
}

export interface PersonModel {
	/** Open Actions waiting on them, oldest wait first (undated waits last). */
	waiting: ActionItem[];
	/** Other open Actions that name them, in card order. */
	withThem: ActionItem[];
	/** Open Actions due today or late. */
	late: number;
	done: number;
	/** The latest completion date among the closed ones. */
	lastDone: Ymd | null;
}

/** Cards shown per column before "Show N more". */
export const PERSON_COLUMN_SIZE = 5;

function compareWaits(a: ActionItem, b: ActionItem): number {
	const sa = a.waitingSince, sb = b.waitingSince;
	if (sa !== sb) {
		if (sa === null) return 1;
		if (sb === null) return -1;
		return sa < sb ? -1 : 1;
	}
	return compareCards(a, b);
}

export function personModel(entries: readonly PersonEntry[], now: Date): PersonModel {
	const open = entries.filter((e) => e.item.category !== 'closed');
	const closed = entries.filter((e) => e.item.category === 'closed').map((e) => e.item);
	const lastDone = closed.reduce<Ymd | null>((latest, item) => {
		const day = parseMtmDate(item.completed)?.date ?? null;
		return day && (!latest || day > latest) ? day : latest;
	}, null);
	return {
		waiting: open.filter((e) => e.waiting).map((e) => e.item).sort(compareWaits),
		withThem: open.filter((e) => !e.waiting).map((e) => e.item).sort(compareCards),
		late: open.filter((e) => isToday(e.item.due, e.item.category, now)).length,
		done: closed.length,
		lastDone,
	};
}

/** The first word of a name, for "Waiting on Marco". */
export function firstName(name: string): string {
	return name.trim().split(/\s+/)[0] ?? name;
}

/** A quick add person token: quoted when the name has several words. */
export function personToken(name: string): string {
	return /\s/.test(name.trim()) ? `@"${name.trim()}" ` : `@${name.trim()} `;
}
