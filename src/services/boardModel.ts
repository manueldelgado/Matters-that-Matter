// What the board shows: visible columns, ordered lanes and sorted cells. Pure.

import type { SphereDef, StatusDef } from '../settings';
import { compareCards, isShownByDone } from '../model/actions';
import { orderLanes, startsCollapsed, type InboxPosition, type Lane, type MatterState, type ReviewInfo } from '../model/matters';
import type { Ymd } from '../model/dates';
import type { ActionItem } from './actionItems';
import { groupBySphere, NO_SPHERE, sphereCounts, sphereKeys, sphereShown, type SphereCounts } from './spheres';

export interface MatterInfo extends Lane {
	icon: string;
	state: MatterState;
	/** Null for the Inbox and for Matters without a cadence. */
	review: ReviewInfo | null;
	/** The Matter's Sphere ID, or null for none (always null for the Inbox). */
	sphere: string | null;
	/** An `mtm-sphere` value that names no Sphere in settings. */
	sphereOrphan: string | null;
}

export interface BoardOptions {
	inboxPosition: InboxPosition;
	showDone: boolean;
	/** "Show done from the last N days"; null shows all closed Actions. */
	doneDays: number | null;
	hideEmptyLanes: boolean;
	/** Type IDs switched off in the toolbar. When every type is off, all show. */
	typesOff: ReadonlySet<string>;
	/** Lanes the user expanded or collapsed on this board, by Matter path. */
	laneToggles: Readonly<Record<string, 'collapsed' | 'expanded'>>;
	/** Spheres from settings, in order; none means no bands. */
	spheres: readonly SphereDef[];
	/** Sphere chips switched off (NO_SPHERE for "No Sphere"). With every chip off, all show. */
	spheresOff: ReadonlySet<string>;
	/** Sphere bands collapsed on this board (NO_SPHERE for "No Sphere"). */
	spheresCollapsed: ReadonlySet<string>;
}

export interface BoardBand {
	/** Null for "No Sphere". */
	sphere: SphereDef | null;
	lanes: BoardLane[];
	counts: SphereCounts;
	collapsed: boolean;
}

export interface BoardLane {
	matter: MatterInfo;
	collapsed: boolean;
	/** Cards per visible status ID, sorted. */
	cells: Map<string, ActionItem[]>;
	openCount: number;
	waitingCount: number;
}

export interface BoardModel {
	columns: StatusDef[];
	/** Every lane shown, in board order (Inbox included; lanes in collapsed bands too). */
	lanes: BoardLane[];
	/** Sphere bands in order, or null when no Spheres are set up. */
	bands: BoardBand[] | null;
	/** The Sphere chips on offer (NO_SPHERE when some Matter has none); empty without Spheres. */
	sphereKeys: string[];
	columnCounts: Map<string, number>;
	/** Visible Actions that are not closed. */
	openCount: number;
	/** True when there are no Actions at all, before any filter. */
	empty: boolean;
}

/** Whether a type passes the toolbar chips. */
export function typeShown(typeId: string, typesOff: ReadonlySet<string>, allTypeIds: readonly string[]): boolean {
	const allOff = allTypeIds.length > 0 && allTypeIds.every((id) => typesOff.has(id));
	return allOff || !typesOff.has(typeId);
}

export function isLaneCollapsed(matter: MatterInfo, toggles: BoardOptions['laneToggles']): boolean {
	const toggle = toggles[matter.path];
	if (toggle) return toggle === 'collapsed';
	return startsCollapsed(matter.state);
}

export function buildBoard(
	actions: readonly ActionItem[],
	matters: readonly MatterInfo[],
	statuses: readonly StatusDef[],
	typeIds: readonly string[],
	options: BoardOptions,
	today: Ymd,
	now?: Date,
): BoardModel {
	const columns = statuses.filter((s) => options.showDone || s.category !== 'closed');
	const columnIds = new Set(columns.map((c) => c.id));

	const visible = actions.filter(
		(a) =>
			columnIds.has(a.effective.status.id) &&
			typeShown(a.effective.type.id, options.typesOff, typeIds) &&
			isShownByDone(a.category, a.completed, options.showDone, options.doneDays, today),
	);

	const byMatter = new Map<string, ActionItem[]>();
	for (const a of visible) {
		const list = byMatter.get(a.effective.matterPath) ?? [];
		list.push(a);
		byMatter.set(a.effective.matterPath, list);
	}

	const keys = sphereKeysFor(matters, options.spheres);
	const shown = (m: MatterInfo) => m.isInbox || keys.length === 0 || sphereShown(m.sphere, options.spheresOff, keys);

	const lanes: BoardLane[] = [];
	const columnCounts = new Map(columns.map((c) => [c.id, 0]));
	let openCount = 0;
	for (const matter of orderMatters(matters, options.spheres, options.inboxPosition)) {
		if (!shown(matter)) continue;
		const mine = byMatter.get(matter.path) ?? [];
		if (options.hideEmptyLanes && mine.length === 0) continue;
		const cells = new Map(columns.map((c) => [c.id, [] as ActionItem[]]));
		for (const a of mine) cells.get(a.effective.status.id)?.push(a);
		for (const [id, list] of cells) {
			list.sort(compareCards);
			columnCounts.set(id, (columnCounts.get(id) ?? 0) + list.length);
		}
		const open = mine.filter((a) => a.category !== 'closed');
		openCount += open.length;
		lanes.push({
			matter,
			collapsed: isLaneCollapsed(matter, options.laneToggles),
			cells,
			openCount: open.length,
			waitingCount: open.filter((a) => a.waitingOn !== null).length,
		});
	}

	let bands: BoardBand[] | null = null;
	if (options.spheres.length) {
		const sections = groupBySphere(
			lanes.filter((l) => !l.matter.isInbox),
			(l) => l.matter.sphere,
			options.spheres,
		);
		bands = sections.map(({ sphere, items }) => ({
			sphere,
			lanes: items,
			counts: sphereCounts(
				items.flatMap((l) => [...l.cells.values()].flat()),
				now ?? new Date(),
			),
			collapsed: options.spheresCollapsed.has(sphere?.id ?? NO_SPHERE),
		}));
	}

	return { columns, lanes, bands, sphereKeys: keys, columnCounts, openCount, empty: actions.length === 0 };
}

/** The Sphere chips for these Matters: every Sphere, plus "No Sphere" when some Matter other than the Inbox has none. */
export function sphereKeysFor(matters: readonly MatterInfo[], spheres: readonly SphereDef[]): string[] {
	if (!spheres.length) return [];
	return sphereKeys(spheres, matters.some((m) => !m.isInbox && m.sphere === null));
}

/** Matters in board order: the Inbox at its position; with Spheres, the rest by Sphere (settings order, none last), then lane order. */
export function orderMatters(matters: readonly MatterInfo[], spheres: readonly SphereDef[], inbox: InboxPosition): MatterInfo[] {
	const ordered = orderLanes(matters, inbox) as MatterInfo[];
	if (!spheres.length) return ordered;
	const inboxLanes = ordered.filter((m) => m.isInbox);
	const rest = groupBySphere(
		ordered.filter((m) => !m.isInbox),
		(m) => m.sphere,
		spheres,
	).flatMap((s) => s.items);
	return inbox === 'top' ? [...inboxLanes, ...rest] : [...rest, ...inboxLanes];
}
