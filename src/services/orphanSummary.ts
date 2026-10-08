// What "Fix orphaned Actions" will change: each unrecognised value once, with the value it gets. Pure.

import type { StatusDef, TypeDef } from '../settings';
import type { ActionItem } from './actionItems';

export type OrphanField = 'status' | 'type' | 'matter';

export interface OrphanGroup {
	field: OrphanField;
	/** The raw value as the badge shows it. */
	raw: string;
	/** Actions with this value. */
	count: number;
	/** The value they get: the status or type they are shown with; the Inbox for Matters. */
	status?: StatusDef;
	type?: TypeDef;
}

export interface OrphanSummary {
	/** Orphaned Actions (each counted once, whatever its fields). */
	items: ActionItem[];
	groups: OrphanGroup[];
}

const FIELD_ORDER: OrphanField[] = ['status', 'type', 'matter'];

export function orphanSummary(all: readonly ActionItem[]): OrphanSummary {
	const items = all.filter((i) => Object.keys(i.effective.orphans).length > 0);
	const groups = new Map<string, OrphanGroup>();
	for (const item of items) {
		for (const field of FIELD_ORDER) {
			const raw = item.effective.orphans[field];
			if (raw === undefined) continue;
			const key = `${field}\u0000${raw}`;
			const group = groups.get(key) ?? {
				field,
				raw,
				count: 0,
				...(field === 'status' ? { status: item.effective.status } : {}),
				...(field === 'type' ? { type: item.effective.type } : {}),
			};
			group.count++;
			groups.set(key, group);
		}
	}
	const sorted = [...groups.values()].sort(
		(a, b) => FIELD_ORDER.indexOf(a.field) - FIELD_ORDER.indexOf(b.field) || b.count - a.count || a.raw.localeCompare(b.raw),
	);
	return { items, groups: sorted };
}
