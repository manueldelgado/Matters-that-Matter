// Spheres: which Sphere a Matter is in, focus, grouping in Sphere order, and counts. Pure.

import type { SphereDef } from '../settings';
import { isOverdue, toYmd } from '../model/dates';
import type { ActionItem } from './actionItems';

/** The key that stands for "No Sphere" in focus settings and collapse toggles. */
export const NO_SPHERE = '';

export interface EffectiveSphere {
	/** A Sphere ID from settings, or null for none. */
	id: string | null;
	/** The raw value when it names no Sphere in settings (shown as a badge, never rewritten). */
	orphan: string | null;
}

/** Absent: no Sphere, no badge. Present but unknown: no Sphere, with the raw value as an orphan. The Inbox never has one. */
export function effectiveSphere(raw: unknown, spheres: readonly SphereDef[], isInbox: boolean): EffectiveSphere {
	if (isInbox || raw === undefined || raw === null || raw === '') return { id: null, orphan: null };
	const value = typeof raw === 'string' || typeof raw === 'number' ? String(raw) : JSON.stringify(raw);
	return spheres.some((s) => s.id === value) ? { id: value, orphan: null } : { id: null, orphan: value };
}

/** Whether a Sphere passes the focus chips: all on by default; with every chip off, all show (as type chips). */
export function sphereShown(id: string | null, off: ReadonlySet<string>, keys: readonly string[]): boolean {
	const allOff = keys.length > 0 && keys.every((k) => off.has(k));
	return allOff || !off.has(id ?? NO_SPHERE);
}

/** The chips a toolbar offers: every Sphere, plus "No Sphere" when some Matter has none. */
export function sphereKeys(spheres: readonly SphereDef[], anyWithout: boolean): string[] {
	return [...spheres.map((s) => s.id), ...(anyWithout ? [NO_SPHERE] : [])];
}

/** The one Sphere in focus (exactly one chip on, and it is a Sphere), for new Matters made from a focused board. */
export function focusedSphere(off: ReadonlySet<string>, keys: readonly string[]): string | null {
	const on = keys.filter((k) => !off.has(k));
	return on.length === 1 && on[0] !== NO_SPHERE ? (on[0] ?? null) : null;
}

export interface SphereSection<T> {
	/** Null for "No Sphere". */
	sphere: SphereDef | null;
	items: T[];
}

/** Items grouped by Sphere in settings order, "No Sphere" last; empty groups are left out; item order is kept. */
export function groupBySphere<T>(items: readonly T[], sphereOf: (item: T) => string | null, spheres: readonly SphereDef[]): SphereSection<T>[] {
	const sections: SphereSection<T>[] = [...spheres.map((sphere) => ({ sphere, items: [] as T[] })), { sphere: null, items: [] as T[] }];
	const index = new Map(spheres.map((s, i) => [s.id, i]));
	for (const item of items) {
		const id = sphereOf(item);
		const i = id === null ? undefined : index.get(id);
		sections[i ?? spheres.length]?.items.push(item);
	}
	return sections.filter((s) => s.items.length > 0);
}

export interface SphereCounts {
	open: number;
	waiting: number;
	/** Due today or overdue, not closed. */
	late: number;
	/** Per status ID: Actions, and those due today or overdue. */
	byStatus: Map<string, { count: number; late: number }>;
}

export function sphereCounts(items: readonly ActionItem[], now: Date): SphereCounts {
	const today = toYmd(now);
	const counts: SphereCounts = { open: 0, waiting: 0, late: 0, byStatus: new Map() };
	for (const item of items) {
		const closed = item.category === 'closed';
		const late = !closed && !!item.due && (isOverdue(item.due, now, false) || item.due.date === today);
		const entry = counts.byStatus.get(item.effective.status.id) ?? { count: 0, late: 0 };
		entry.count++;
		if (late) entry.late++;
		counts.byStatus.set(item.effective.status.id, entry);
		if (closed) continue;
		counts.open++;
		if (item.waitingOn !== null) counts.waiting++;
		if (late) counts.late++;
	}
	return counts;
}
