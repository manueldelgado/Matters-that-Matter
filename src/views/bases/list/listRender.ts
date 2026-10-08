// The list: rows grouped by Matter, in a table that becomes two-line rows when narrow.

import { Keymap, setIcon, setTooltip } from 'obsidian';
import { STRINGS } from '../../../strings';
import type { ActionItem } from '../../../services/actionItems';
import type { ListGroup } from '../../../services/listModel';
import { avatarEl, dueEl, orphanBadge, priorityEl } from '../../../ui/components/card';
import { appendIcon, statusChip, tileEl, typeClasses } from '../../../ui/components/dom';

export interface ListHandlers {
	openMatter: (path: string) => void;
	newAction: (matterPath: string) => void;
	/** Opens the status menu under the chip. */
	statusMenu: (item: ActionItem, chip: HTMLElement) => void;
	select: (path: string) => void;
	open: (path: string, e: MouseEvent | KeyboardEvent) => void;
	dismiss: (item: ActionItem) => void;
}

export interface ListInput {
	groups: ListGroup[];
	selected: string | null;
	now: Date;
}

function pressable(el: HTMLElement, onPress: (e: MouseEvent | KeyboardEvent) => void): HTMLElement {
	el.setAttrs({ role: 'button', tabindex: 0 });
	el.addEventListener('click', onPress);
	el.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onPress(e);
		}
	});
	return el;
}

export function renderList(view: HTMLElement, input: ListInput, h: ListHandlers): HTMLElement {
	const scroll = view.createDiv({ cls: 'mtm-scroll' });
	if (!input.groups.length) {
		scroll.createDiv({ cls: 'mtm-empty', text: STRINGS.list.noMatches });
		return scroll;
	}
	const table = scroll.createDiv({ cls: 'mtm-table' });
	const head = table.createDiv({ cls: 'mtm-table-head' });
	for (const label of STRINGS.list.columns) head.createSpan({ text: label });
	for (const group of input.groups) {
		renderGroupHeader(table, group, h);
		for (const item of group.rows) renderRow(table, item, input, h);
	}
	return scroll;
}

function renderGroupHeader(table: HTMLElement, group: ListGroup, h: ListHandlers): void {
	const l = STRINGS.list;
	const { matter, openCount, waitingCount } = group.lane;
	const header = table.createDiv({ cls: 'mtm-table-group' });
	setIcon(header.createSpan({ cls: 'mtm-matter-icon' }), matter.icon);
	pressable(header.createSpan({ cls: 'mtm-table-group-title', text: matter.name }), () => h.openMatter(matter.path));
	const meta = matter.isInbox ? l.notFiled : [l.open(openCount), ...(waitingCount ? [l.waiting(waitingCount)] : [])].join(' · ');
	header.createSpan({ cls: 'mtm-table-group-meta', text: meta });
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
