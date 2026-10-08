// Board DOM: toolbar, sticky headers, lanes, cells and cards. No state of its own.

import { setIcon, setTooltip } from 'obsidian';
import type { StatusDef, TypeDef } from '../../../settings';
import { STRINGS } from '../../../strings';
import type { ActionItem } from '../../../services/actionItems';
import type { BoardLane, BoardModel } from '../../../services/boardModel';
import { appendIcon, statusClasses, tileEl, typeClasses } from '../../../ui/components/dom';
import { renderCard } from '../../../ui/components/card';

export interface BoardHandlers {
	toggleType(typeId: string): void;
	toggleDone(): void;
	newAction(statusId?: string, matterPath?: string): void;
	newMatter(): void;
	toggleLane(path: string): void;
	openMatter(path: string): void;
	laneMenu(lane: BoardLane, e: MouseEvent, button: HTMLElement): void;
	markReviewed(path: string): void;
	select(path: string): void;
	open(path: string, e: MouseEvent | KeyboardEvent): void;
	dismiss(item: ActionItem): void;
}

export interface RenderInput {
	model: BoardModel;
	types: TypeDef[];
	typesOff: ReadonlySet<string>;
	showDone: boolean;
	selected: string | null;
	now: Date;
}

export function renderEmpty(view: HTMLElement, h: Pick<BoardHandlers, 'newAction' | 'newMatter'>): void {
	const empty = view.createDiv({ cls: 'mtm-scroll' }).createDiv({ cls: 'mtm-board-empty' });
	tileEl(empty, 'sprout', 'mod-xl mtm-type-call mtm-tone-mint');
	empty.createEl('h2', { cls: 'mtm-board-empty-title', text: STRINGS.board.emptyTitle });
	empty.createEl('p', { cls: 'mtm-board-empty-text', text: STRINGS.board.emptyText });
	const actions = empty.createDiv({ cls: 'mtm-board-empty-actions' });
	actions.createEl('button', { cls: 'mod-cta', text: STRINGS.board.newAction }).addEventListener('click', () => h.newAction());
	actions.createEl('button', { text: STRINGS.board.newMatter }).addEventListener('click', () => h.newMatter());
	empty.createSpan({ cls: 'mtm-field-hint', text: STRINGS.board.emptyHint });
	const ghost = empty.createDiv({ cls: 'mtm-board-empty-ghost' });
	for (let i = 0; i < 3; i++) ghost.createSpan();
}

function laneMods(lane: BoardLane): string[] {
	const m = lane.matter;
	return [...(m.isInbox ? ['mod-inbox'] : []), ...(m.state === 'dormant' ? ['mod-dormant'] : []), ...(m.state === 'closed' ? ['mod-closed'] : [])];
}

function renderLaneHeader(board: HTMLElement, lane: BoardLane, h: BoardHandlers): HTMLElement {
	const m = lane.matter;
	const b = STRINGS.board;
	const reviewDue = !!m.review?.due && m.state === 'active';
	const header = board.createDiv({
		cls: ['mtm-lane-header', ...laneMods(lane), ...(lane.collapsed ? ['is-collapsed'] : []), ...(reviewDue ? ['is-review-due'] : [])],
		attr: { 'data-lane': m.path },
	});

	const row = header.createDiv({ cls: 'mtm-lane-row' });
	if (!m.isInbox) {
		const handle = row.createSpan({ cls: 'mtm-lane-handle', attr: { draggable: 'true', 'aria-label': b.dragLane } });
		appendIcon(handle, 'grip-vertical');
	}
	const toggle = row.createSpan({ cls: 'mtm-lane-toggle', attr: { 'aria-label': b.collapse, role: 'button' } });
	appendIcon(toggle, 'chevron-down');
	toggle.addEventListener('click', () => h.toggleLane(m.path));
	setIcon(row.createSpan({ cls: 'mtm-matter-icon' }), m.icon);
	const title = row.createSpan({ cls: 'mtm-lane-title', text: m.name });
	title.addEventListener('click', () => h.openMatter(m.path));
	if (!m.isInbox) {
		const menu = row.createDiv({ cls: 'clickable-icon mtm-lane-menu', attr: { 'aria-label': b.laneMenu } });
		appendIcon(menu, 'ellipsis');
		menu.addEventListener('click', (e) => h.laneMenu(lane, e, menu));
	}

	const meta = header.createDiv({ cls: 'mtm-lane-meta' });
	if (m.isInbox) {
		meta.createSpan({ text: b.notFiled });
	} else {
		meta.createSpan({ text: b.open(lane.openCount) });
		if (lane.waitingCount) meta.createSpan({ cls: 'mod-waiting', text: b.waiting(lane.waitingCount) });
		if (m.state !== 'active') {
			const badge = meta.createSpan({ cls: ['mtm-lane-state', `mod-${m.state}`] });
			appendIcon(badge, m.state === 'dormant' ? 'moon' : 'archive');
			badge.appendText(m.state === 'dormant' ? b.dormant : b.closed);
		}
		const r = m.review;
		if (r && m.state === 'active') {
			const kind = r.lastReviewed === null ? 'never' : r.due ? 'overdue' : 'ontime';
			const el = meta.createSpan({ cls: ['mtm-review', `is-${kind}`] });
			appendIcon(el, kind === 'ontime' ? 'circle-check' : kind === 'overdue' ? 'circle-alert' : 'circle-dashed');
			el.appendText(kind === 'ontime' ? b.reviewedAgo(r.daysSince ?? 0) : kind === 'overdue' ? b.reviewDue : b.notReviewed);
			setTooltip(el, r.daysSince === null ? b.neverReviewed : b.reviewedAgo(r.daysSince));
		}
	}
	if (m.review && m.state === 'active' && !lane.collapsed) {
		const button = header.createEl('button', { cls: 'mtm-review-button' });
		appendIcon(button, 'check');
		button.appendText(b.markReviewed);
		button.addEventListener('click', () => h.markReviewed(m.path));
	}
	return header;
}

function renderCell(board: HTMLElement, lane: BoardLane, column: StatusDef, input: RenderInput, h: BoardHandlers): void {
	const closedColumn = column.category === 'closed';
	const cell = board.createDiv({
		cls: ['mtm-cell', ...(closedColumn ? ['mod-done'] : []), ...laneMods(lane), ...(lane.collapsed ? ['is-collapsed'] : [])],
		attr: { 'data-lane': lane.matter.path, 'data-status': column.id },
	});
	const cards = lane.cells.get(column.id) ?? [];
	if (lane.collapsed) {
		if (!cards.length) return;
		const dots = cell.createDiv({ cls: 'mtm-lane-dots' });
		for (const item of cards) {
			const dot = dots.createSpan({ cls: ['mtm-lane-dot', ...typeClasses(item.effective.type)], attr: { 'data-path': item.path } });
			setTooltip(dot, item.title);
			dot.addEventListener('click', () => h.select(item.path));
		}
		return;
	}
	for (const item of cards) {
		const card = renderCard(cell, item, { now: input.now, selected: item.path === input.selected, onDismiss: (i) => h.dismiss(i) });
		card.addEventListener('click', (e) => {
			if (e.metaKey || e.ctrlKey) h.open(item.path, e);
			else h.select(item.path);
		});
		card.addEventListener('dblclick', (e) => h.open(item.path, e));
		card.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') h.open(item.path, e);
			else if (e.key === ' ') {
				e.preventDefault();
				h.select(item.path);
			}
		});
	}
	if (!closedColumn && lane.matter.state !== 'closed') {
		const add = cell.createDiv({ cls: 'mtm-cell-add', attr: { tabindex: 0, role: 'button' } });
		appendIcon(add, 'plus');
		add.appendText(STRINGS.board.addAction);
		add.addEventListener('click', () => h.newAction(column.id, lane.matter.path));
	}
}

export function renderBoard(view: HTMLElement, input: RenderInput, h: BoardHandlers): HTMLElement {
	const { model } = input;
	const scroll = view.createDiv({ cls: 'mtm-board-scroll' });
	const board = scroll.createDiv({ cls: 'mtm-board' });
	board.setCssProps({ '--mtm-cols': String(model.columns.length) });

	board.createDiv({ cls: 'mtm-board-corner', text: STRINGS.board.corner });
	for (const column of model.columns) {
		const header = board.createDiv({ cls: ['mtm-col-header', ...statusClasses(column)] });
		header.createSpan({ cls: 'mtm-status-dot' });
		header.createSpan({ cls: 'mtm-col-title', text: column.label });
		header.createSpan({ cls: 'mtm-col-count', text: String(model.columnCounts.get(column.id) ?? 0) });
	}

	model.lanes.forEach((lane, i) => {
		const inbox = lane.matter.isInbox;
		if (inbox && i > 0) board.createDiv({ cls: 'mtm-lane-sep' });
		renderLaneHeader(board, lane, h);
		for (const column of model.columns) renderCell(board, lane, column, input, h);
		if (inbox && i === 0 && model.lanes.length > 1) board.createDiv({ cls: 'mtm-lane-sep' });
	});
	return scroll;
}
