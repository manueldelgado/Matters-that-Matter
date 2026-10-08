// An Action as every view sees it: raw note values plus effective values. Pure.

import type { StatusCategory } from '../settings';
import { parsePriority, isWaiting, type Priority } from '../model/actions';
import { parseMtmDate, type MtmDate } from '../model/dates';
import { effectiveAction, linkText, type EffectiveAction, type ResolveLink, type WorkflowSettings } from './effective';

export interface ActionItem {
	path: string;
	title: string;
	effective: EffectiveAction;
	category: StatusCategory;
	priority: Priority | null;
	start: MtmDate | null;
	due: MtmDate | null;
	completed: unknown;
	/** Link text of mtm-waiting-on, when set and the Action is not closed. */
	waitingOn: string | null;
	/** mtm-waiting-since as a day, when waiting and the date is valid. */
	waitingSince: string | null;
	/** Resolved body links to other notes (filled in by the vault layer). */
	linkedCount: number;
}

export function toActionItem(
	path: string,
	title: string,
	fm: Readonly<Record<string, unknown>> | null | undefined,
	settings: WorkflowSettings,
	resolve: ResolveLink,
	linkedCount = 0,
): ActionItem {
	const raw = fm ?? {};
	const effective = effectiveAction(raw, settings, resolve);
	const waiting = isWaiting(raw['mtm-waiting-on'], effective.category) ? linkText(raw['mtm-waiting-on']) : null;
	return {
		path,
		title,
		effective,
		category: effective.category,
		priority: parsePriority(raw['mtm-priority']),
		start: parseMtmDate(raw['mtm-start']),
		due: parseMtmDate(raw['mtm-due']),
		completed: raw['mtm-completed'],
		waitingOn: waiting,
		waitingSince: waiting ? (parseMtmDate(raw['mtm-waiting-since'])?.date ?? null) : null,
		linkedCount,
	};
}

/** Two-letter initials for avatars: "Marco Rossi" → "MR"; a path keeps only its last part. */
export function initials(name: string): string {
	const base = name.split('/').pop() ?? name;
	return base
		.split(/\s+/)
		.filter(Boolean)
		.map((w) => Array.from(w)[0] ?? '')
		.slice(0, 2)
		.join('')
		.toUpperCase();
}
