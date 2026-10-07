// What the board shows: visible columns, ordered lanes and sorted cells. Pure.

import type { StatusDef } from '../settings';
import { compareCards, isShownByDone } from '../model/actions';
import { orderLanes, startsCollapsed, type InboxPosition, type Lane, type MatterState, type ReviewInfo } from '../model/matters';
import type { Ymd } from '../model/dates';
import type { ActionItem } from './actionItems';

export interface MatterInfo extends Lane {
	icon: string;
	state: MatterState;
	/** Null for the Inbox and for Matters without a cadence. */
	review: ReviewInfo | null;
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
	lanes: BoardLane[];
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

	const lanes: BoardLane[] = [];
	const columnCounts = new Map(columns.map((c) => [c.id, 0]));
	let openCount = 0;
	for (const matter of orderLanes(matters, options.inboxPosition) as MatterInfo[]) {
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

	return { columns, lanes, columnCounts, openCount, empty: actions.length === 0 };
}
