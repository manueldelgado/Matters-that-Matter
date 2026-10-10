// Actions and Matters as the operations return them.

import { isToday } from '../model/actions';
import { formatMtmDate, isOverdue, parseMtmDate } from '../model/dates';
import { formatCadence } from '../model/matters';
import type { ActionItem } from '../services/actionItems';
import type { MatterInfo } from '../services/boardModel';
import { linkText } from '../services/effective';
import { lacksNextAction } from '../services/nextAction';
import type { ActionSummary, MatterSummary, NoteRef, Snapshot } from './types';
import { baseName, mtmProperties, vaultView } from './vaultView';

/** A frontmatter link as a note reference: the resolved note, or the link text when it resolves to nothing. */
export function noteRef(raw: unknown, fromPath: string, s: Snapshot): NoteRef | null {
	const text = linkText(raw);
	if (!text) return null;
	const path = s.resolve(text, fromPath);
	return path ? { path, name: baseName(path) } : { path: null, name: text };
}

export function matterName(path: string, s: Snapshot): string {
	return vaultView(s).matters.find((m) => m.path === path)?.name ?? baseName(path);
}

export function actionSummary(item: ActionItem, fm: Readonly<Record<string, unknown>> | undefined, s: Snapshot): ActionSummary {
	const { effective } = item;
	const raw = fm ?? {};
	const closed = item.category === 'closed';
	const waiting = item.waitingOn === null ? null : noteRef(raw['mtm-waiting-on'], item.path, s);
	return {
		path: item.path,
		title: item.title,
		matter: { path: effective.matterPath, name: matterName(effective.matterPath, s), isInbox: effective.matterPath === s.settings.inboxPath },
		status: { id: effective.status.id, label: effective.status.label, category: effective.category },
		type: { id: effective.type.id, label: effective.type.label },
		priority: item.priority,
		start: item.start && formatMtmDate(item.start),
		due: item.due && formatMtmDate(item.due),
		today: isToday(item.due, item.category, s.now),
		overdue: isOverdue(item.due, s.now, closed),
		waitingOn: waiting,
		waitingSince: item.waitingSince,
		completed: parseMtmDate(raw['mtm-completed'])?.date ?? null,
		orphans: (['status', 'type', 'matter'] as const).flatMap((field) => {
			const value = effective.orphans[field];
			return value === undefined ? [] : [{ field, raw: value }];
		}),
		raw: mtmProperties(raw),
	};
}

export function matterSummary(matter: MatterInfo, items: readonly ActionItem[], s: Snapshot): MatterSummary {
	const mine = items.filter((i) => i.effective.matterPath === matter.path);
	const sphere = matter.sphere === null ? null : (s.settings.spheres.find((x) => x.id === matter.sphere) ?? null);
	const review = matter.review;
	return {
		path: matter.path,
		name: matter.name,
		icon: matter.icon,
		isInbox: matter.isInbox,
		state: matter.state,
		sphere: sphere && { id: sphere.id, label: sphere.label },
		sphereOrphan: matter.sphereOrphan,
		outcome: matter.outcome,
		laneOrder: matter.laneOrder,
		review:
			review && review.cadence
				? { every: formatCadence(review.cadence), lastReviewed: review.lastReviewed, nextDue: review.nextDue, due: review.due, daysSince: review.daysSince }
				: null,
		counts: {
			open: mine.filter((i) => i.category !== 'closed').length,
			today: mine.filter((i) => isToday(i.due, i.category, s.now)).length,
			waiting: mine.filter((i) => i.waitingOn !== null).length,
			closed: mine.filter((i) => i.category === 'closed').length,
			total: mine.length,
		},
		noNextAction: lacksNextAction(matter, mine),
	};
}
