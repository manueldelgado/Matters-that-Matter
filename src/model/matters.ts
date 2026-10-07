// Matter rules: state, review cadence and lane order.

import { addDays, addMonths, daysBetween, parseMtmDate, type Ymd } from './dates';

export type MatterState = 'active' | 'dormant' | 'closed';

/** Absent or unknown values count as active. */
export function matterState(raw: unknown): MatterState {
	return raw === 'dormant' || raw === 'closed' ? raw : 'active';
}

/** Dormant and closed Matters start collapsed. */
export function startsCollapsed(state: MatterState): boolean {
	return state !== 'active';
}

// ——— Review ———

export interface Cadence {
	n: number;
	unit: 'd' | 'w' | 'm';
}

/** `<n>d`, `<n>w` or `<n>m` (calendar months); anything else means no cadence. */
export function parseCadence(raw: unknown): Cadence | null {
	if (typeof raw !== 'string') return null;
	const m = /^\s*(\d+)\s*([dwm])\s*$/i.exec(raw);
	if (!m) return null;
	const n = Number(m[1]);
	if (n < 1) return null;
	return { n, unit: (m[2] ?? 'd').toLowerCase() as Cadence['unit'] };
}

/** The form the plugin writes: `<n>d`, `<n>w` or `<n>m`. */
export function formatCadence(c: Cadence): string {
	return `${c.n}${c.unit}`;
}

export function addCadence(ymd: Ymd, c: Cadence): Ymd {
	if (c.unit === 'm') return addMonths(ymd, c.n);
	return addDays(ymd, c.unit === 'w' ? c.n * 7 : c.n);
}

export interface ReviewInfo {
	cadence: Cadence | null;
	lastReviewed: Ymd | null;
	/** Days since the last review; null if never reviewed. */
	daysSince: number | null;
	/** When the next review is due; null without a cadence or before the first review. */
	nextDue: Ymd | null;
	/** A Matter with a cadence that has never been reviewed counts as due. */
	due: boolean;
}

export function reviewInfo(rawCadence: unknown, rawLastReviewed: unknown, today: Ymd): ReviewInfo {
	const cadence = parseCadence(rawCadence);
	const lastReviewed = parseMtmDate(rawLastReviewed)?.date ?? null;
	const daysSince = lastReviewed ? daysBetween(lastReviewed, today) : null;
	const nextDue = cadence && lastReviewed ? addCadence(lastReviewed, cadence) : null;
	const due = !!cadence && (nextDue === null || nextDue <= today);
	return { cadence, lastReviewed, daysSince, nextDue, due };
}

// ——— Lane order ———

export interface Lane {
	path: string;
	name: string;
	laneOrder: number | null;
	isInbox: boolean;
}

export type InboxPosition = 'top' | 'bottom' | 'hidden';

export function parseLaneOrder(raw: unknown): number | null {
	if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
	if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) return Number(raw);
	return null;
}

const byName = (a: Lane, b: Lane) =>
	a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) || (a.path < b.path ? -1 : 1);

/** Inbox at its position; the rest by lane order, then name; lanes without an order last, by name. */
export function orderLanes(lanes: readonly Lane[], inbox: InboxPosition): Lane[] {
	const rest = lanes
		.filter((l) => !l.isInbox)
		.sort((a, b) => {
			if (a.laneOrder !== null && b.laneOrder !== null && a.laneOrder !== b.laneOrder) return a.laneOrder - b.laneOrder;
			if (a.laneOrder === null && b.laneOrder !== null) return 1;
			if (a.laneOrder !== null && b.laneOrder === null) return -1;
			return byName(a, b);
		});
	const inboxLanes = inbox === 'hidden' ? [] : lanes.filter((l) => l.isInbox);
	return inbox === 'top' ? [...inboxLanes, ...rest] : [...rest, ...inboxLanes];
}

/** A new Matter gets the highest lane order + 1. */
export function nextLaneOrder(lanes: readonly Lane[]): number {
	const orders = lanes.filter((l) => !l.isInbox && l.laneOrder !== null).map((l) => l.laneOrder as number);
	return orders.length ? Math.floor(Math.max(...orders)) + 1 : 1;
}

export interface LaneOrderWrite {
	path: string;
	laneOrder: number;
}

/**
 * Moves a lane within the ordered non-Inbox lanes and renumbers them 1…n.
 * Returns only the lanes whose order changes.
 */
export function moveLane(ordered: readonly Lane[], path: string, toIndex: number): LaneOrderWrite[] {
	const lanes = ordered.filter((l) => !l.isInbox);
	const from = lanes.findIndex((l) => l.path === path);
	if (from < 0) return [];
	const [lane] = lanes.splice(from, 1);
	if (!lane) return [];
	lanes.splice(Math.max(0, Math.min(toIndex, lanes.length)), 0, lane);
	return lanes
		.map((l, i) => ({ lane: l, laneOrder: i + 1 }))
		.filter(({ lane: l, laneOrder }) => l.laneOrder !== laneOrder)
		.map(({ lane: l, laneOrder }) => ({ path: l.path, laneOrder }));
}

/** "Move up" / "Move down" in the lane menu. */
export function moveLaneBy(ordered: readonly Lane[], path: string, delta: -1 | 1): LaneOrderWrite[] {
	const lanes = ordered.filter((l) => !l.isInbox);
	const from = lanes.findIndex((l) => l.path === path);
	const to = from + delta;
	if (from < 0 || to < 0 || to >= lanes.length) return [];
	return moveLane(lanes, path, to);
}
