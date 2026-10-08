// The list: rows grouped by Matter, in a table that becomes two-line rows when narrow.

import { Keymap, setIcon, setTooltip } from 'obsidian';
import { STRINGS } from '../../../strings';
import type { ActionItem } from '../../../services/actionItems';
import type { BoardLane } from '../../../services/boardModel';
import type { ListGroup, ListLayout, ListSection } from '../../../services/listModel';
import { NO_SPHERE } from '../../../services/spheres';
import { NO_SPHERE_ICON } from '../collectionView';
import { avatarEl, dueEl, orphanBadge, priorityEl, waitAgeEl, waitingTitle } from '../../../ui/components/card';
import { waitAge } from '../../../model/actions';
import { toYmd } from '../../../model/dates';
import { appendIcon, pressable, statusChip, tileEl, typeClasses } from '../../../ui/components/dom';
import { nextStepGhost, noNextActionHint } from '../../../ui/components/nextAction';

export interface ListHandlers {
	openMatter: (path: string) => void;
	newAction: (matterPath: string, statusId?: string) => void;
	/** The "No next Action" hint's menu. */
	noNextActionMenu: (lane: BoardLane, anchor: HTMLElement) => void;
	/** Opens the status menu under the chip. */
	statusMenu: (item: ActionItem, chip: HTMLElement) => void;
	select: (path: string) => void;
	open: (path: string, e: MouseEvent | KeyboardEvent) => void;
	dismiss: (item: ActionItem) => void;
	toggleSection: (key: string) => void;
}

export interface ListInput {
	layout: ListLayout;
	selected: string | null;
	now: Date;
	/** The status for a Matter's next step, or null. */
	nextStepId: string | null;
}

export function renderList(view: HTMLElement, input: ListInput, h: ListHandlers): HTMLElement {
	const scroll = view.createDiv({ cls: 'mtm-scroll' });
	const { layout } = input;
	if (!layout.groups.length) {
		scroll.createDiv({ cls: 'mtm-empty', text: STRINGS.list.noMatches });
		return scroll;
	}
	const table = scroll.createDiv({ cls: 'mtm-table' });
	const head = table.createDiv({ cls: 'mtm-table-head' });
	for (const label of STRINGS.list.columns) head.createSpan({ text: label });
	const renderGroup = (group: ListGroup, inSphere = false) => {
		renderGroupHeader(table, group, h, inSphere);
		const nextStepId = input.nextStepId;
		if (group.lane.noNextAction && nextStepId) nextStepGhost(table, () => h.newAction(group.lane.matter.path, nextStepId), 'mod-row');
		for (const item of group.rows) renderRow(table, item, input, h);
	};
	if (!layout.sections) {
		layout.groups.forEach((g) => renderGroup(g));
		return scroll;
	}
	if (layout.inbox && layout.inboxFirst) renderGroup(layout.inbox);
	for (const section of layout.sections) {
		renderSectionHeader(table, section, h);
		if (!section.collapsed) section.groups.forEach((g) => renderGroup(g, true));
	}
	if (layout.inbox && !layout.inboxFirst) renderGroup(layout.inbox);
	return scroll;
}

/** A Sphere heading with its counts; collapsing it hides its Matters. */
function renderSectionHeader(table: HTMLElement, section: ListSection, h: ListHandlers): void {
	const sp = STRINGS.spheres;
	const key = section.sphere?.id ?? NO_SPHERE;
	const header = table.createDiv({ cls: ['mtm-table-sphere', ...(section.collapsed ? ['is-collapsed'] : [])] });
	const toggle = pressable(header.createSpan({ cls: 'mtm-lane-toggle', attr: { 'aria-label': STRINGS.board.collapse } }), () => h.toggleSection(key));
	appendIcon(toggle, 'chevron-down');
	tileEl(header, section.sphere?.icon ?? NO_SPHERE_ICON, 'mod-neutral');
	pressable(header.createSpan({ cls: 'mtm-table-sphere-title', text: section.sphere?.label ?? sp.none }), () => h.toggleSection(key));
	const meta = header.createSpan({ cls: 'mtm-table-sphere-meta' });
	const { open, late, waiting } = section.counts;
	meta.createSpan({ text: sp.open(open) });
	if (late) meta.createSpan({ cls: 'mod-late', text: sp.late(late) });
	if (waiting) meta.createSpan({ cls: 'mod-waiting', text: sp.waiting(waiting) });
}

function renderGroupHeader(table: HTMLElement, group: ListGroup, h: ListHandlers, inSphere: boolean): void {
	const l = STRINGS.list;
	const { matter, openCount, waitingCount } = group.lane;
	const header = table.createDiv({ cls: ['mtm-table-group', ...(inSphere ? ['mod-in-sphere'] : [])] });
	setIcon(header.createSpan({ cls: 'mtm-matter-icon' }), matter.icon);
	pressable(header.createSpan({ cls: 'mtm-table-group-title', text: matter.name }), () => h.openMatter(matter.path));
	const meta = matter.isInbox ? l.notFiled : [l.open(openCount), ...(waitingCount ? [l.waiting(waitingCount)] : [])].join(' · ');
	header.createSpan({ cls: 'mtm-table-group-meta', text: meta });
	if (group.lane.noNextAction) noNextActionHint(header, (el) => h.noNextActionMenu(group.lane, el));
	if (matter.state !== 'active') {
		const badge = header.createSpan({ cls: ['mtm-lane-state', `mod-${matter.state}`] });
		appendIcon(badge, matter.state === 'dormant' ? 'moon' : 'archive');
		badge.appendText(matter.state === 'dormant' ? STRINGS.board.dormant : STRINGS.board.closed);
	}
	if (matter.state !== 'closed') {
		const add = header.createDiv({ cls: ['clickable-icon', 'mtm-table-add'], attr: { 'aria-label': l.newAction } });
		appendIcon(add, 'plus');
		pressable(add, () => h.newAction(matter.path));
	}
}

const empty = (cell: HTMLElement) => cell.createSpan({ cls: 'mtm-table-empty', text: '—' });

function renderRow(table: HTMLElement, item: ActionItem, input: ListInput, h: ListHandlers): void {
	const { type, status } = item.effective;
	const done = item.category === 'closed';
	const row = table.createDiv({
		cls: ['mtm-table-row', ...typeClasses(type), ...(done ? ['is-done'] : []), ...(item.path === input.selected ? ['is-selected'] : [])],
		attr: { tabindex: 0, 'data-path': item.path },
	});

	const title = row.createSpan({ cls: 'mtm-table-title' });
	title.createSpan({ cls: 'mtm-type-stripe' });
	setTooltip(tileEl(title, type.icon, 'mod-xs'), type.label);
	title.createSpan({ cls: 'mtm-table-title-text', text: item.title });
	for (const field of ['status', 'matter', 'type'] as const) {
		const value = item.effective.orphans[field];
		if (value !== undefined) orphanBadge(title, field, value, true, () => h.dismiss(item));
	}

	// One cell per column when wide; a single meta line when narrow (CSS).
	const meta = row.createSpan({ cls: 'mtm-table-meta' });
	const chip = statusChip(meta, status);
	chip.setAttrs({ role: 'button', tabindex: 0, 'aria-label': STRINGS.list.changeStatus });
	chip.addEventListener('click', (e) => {
		e.stopPropagation();
		h.statusMenu(item, chip);
	});
	chip.addEventListener('dblclick', (e) => e.stopPropagation());
	chip.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			h.statusMenu(item, chip);
		}
	});
	const dueCell = meta.createSpan();
	if (item.due) dueEl(dueCell, item.due, input.now, done);
	else empty(dueCell);
	const priorityCell = meta.createSpan();
	if (item.priority) priorityEl(priorityCell, item.priority, true);
	else empty(priorityCell);
	const waitingCell = meta.createSpan();
	if (item.waitingOn) {
		const name = item.waitingOn.split('/').pop() ?? item.waitingOn;
		const waiting = waitingCell.createSpan({ cls: ['mtm-link-chip', 'mod-waiting'] });
		avatarEl(waiting, name, 'mod-sm');
		waiting.createSpan({ cls: 'mtm-table-waiting-name', text: name });
		waiting.appendText(' ');

		setTooltip(waiting, waitingTitle(item.waitingOn, item.waitingSince, input.now));
		if (item.waitingSince) {
			// Long after the chip in the table; short in two-line rows (CSS shows one).
			const age = waitAge(item.waitingSince, toYmd(input.now));
			waitAgeEl(waitingCell, age, false, 'mod-long');
			waitAgeEl(waitingCell, age, true, 'mod-short');
		}
	}

	const count = row.createSpan({ cls: 'mtm-table-num', text: item.linkedCount ? String(item.linkedCount) : '' });
	if (item.linkedCount) setTooltip(count, STRINGS.list.linkedNotes);

	row.addEventListener('click', (e) => {
		if (Keymap.isModEvent(e)) h.open(item.path, e);
		else h.select(item.path);
	});
	row.addEventListener('dblclick', (e) => h.open(item.path, e));
	row.addEventListener('keydown', (e) => {
		if (e.target !== row) return;
		if (e.key === 'Enter') h.open(item.path, e);
		else if (e.key === ' ') {
			e.preventDefault();
			h.select(item.path);
		}
	});
}
