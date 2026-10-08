// Board DOM: toolbar, sticky headers, lanes, cells and cards. No state of its own.

import { setIcon, setTooltip } from 'obsidian';
import type { StatusDef, TypeDef } from '../../../settings';
import { STRINGS } from '../../../strings';
import type { ActionItem } from '../../../services/actionItems';
import type { BoardBand, BoardLane, BoardModel } from '../../../services/boardModel';
import { NO_SPHERE } from '../../../services/spheres';
import { appendIcon, pressable, statusClasses, tileEl, typeClasses } from '../../../ui/components/dom';
import { bindCardActions, orphanBadge, renderCard } from '../../../ui/components/card';
import { nextStepGhost, noNextActionHint } from '../../../ui/components/nextAction';
import { NO_SPHERE_ICON } from '../collectionView';

export interface BoardHandlers {
	toggleType(typeId: string): void;
	toggleSphere(key: string): void;
	toggleDone(): void;
	newAction(statusId?: string, matterPath?: string): void;
	newMatter(): void;
	toggleLane(path: string): void;
	openMatter(path: string): void;
	laneMenu(lane: BoardLane, e: MouseEvent, button: HTMLElement): void;
	/** The "No next Action" hint's menu. */
	noNextActionMenu(lane: BoardLane, anchor: HTMLElement): void;
	processInbox(): void;
	markReviewed(path: string): void;
	/** Collapses or expands a Sphere band (NO_SPHERE for "No Sphere"). */
	toggleBand(key: string): void;
	bandMenu(band: BoardBand, e: MouseEvent, button: HTMLElement): void;
	/** Removes an `mtm-sphere` value that names no Sphere. */
	dismissSphere(path: string): void;
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
	/** The column for a lane's next step (first open status after the backlog), or null. */
	nextStepId: string | null;
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
		cls: [
			'mtm-lane-header',
			...laneMods(lane),
			...(lane.collapsed ? ['is-collapsed'] : []),
			...(reviewDue ? ['is-review-due'] : []),
			...(lane.noNextAction ? ['is-stalled'] : []),
		],
		attr: { 'data-lane': m.path, ...(m.isInbox ? {} : { 'data-sphere': m.sphere ?? NO_SPHERE }) },
	});

	const row = header.createDiv({ cls: 'mtm-lane-row' });
	if (!m.isInbox) {
		const handle = row.createSpan({ cls: 'mtm-lane-handle', attr: { draggable: 'true', 'aria-label': b.dragLane } });
		appendIcon(handle, 'grip-vertical');
	}
	const toggle = pressable(row.createSpan({ cls: 'mtm-lane-toggle', attr: { 'aria-label': b.collapse } }), () => h.toggleLane(m.path));
	appendIcon(toggle, 'chevron-down');
	setIcon(row.createSpan({ cls: 'mtm-matter-icon' }), m.icon);
	const title = pressable(row.createSpan({ cls: 'mtm-lane-title', text: m.name }), () => h.openMatter(m.path));
	if (m.outcome) setTooltip(title, `${STRINGS.overview.outcome}: ${m.outcome}`);
	if (!m.isInbox) {
		const menu = row.createDiv({ cls: 'clickable-icon mtm-lane-menu', attr: { 'aria-label': b.laneMenu } });
		appendIcon(menu, 'ellipsis');
		menu.addEventListener('click', (e) => h.laneMenu(lane, e, menu));
	}

	const meta = header.createDiv({ cls: 'mtm-lane-meta' });
	if (m.isInbox) {
		meta.createSpan({ text: lane.openCount ? STRINGS.process.laneMeta(lane.openCount) : b.notFiled });
	} else {
		meta.createSpan({ text: b.open(lane.openCount) });
		if (lane.waitingCount) meta.createSpan({ cls: 'mod-waiting', text: b.waiting(lane.waitingCount) });
		if (m.state !== 'active') {
			const badge = meta.createSpan({ cls: ['mtm-lane-state', `mod-${m.state}`] });
			appendIcon(badge, m.state === 'dormant' ? 'moon' : 'archive');
			badge.appendText(m.state === 'dormant' ? b.dormant : b.closed);
		}
		if (lane.noNextAction) noNextActionHint(meta, (el) => h.noNextActionMenu(lane, el));
		if (m.sphereOrphan !== null) orphanBadge(meta, 'sphere', m.sphereOrphan, true, () => h.dismissSphere(m.path));
		const r = m.review;
		if (r && m.state === 'active') {
			const kind = r.lastReviewed === null ? 'never' : r.due ? 'overdue' : 'ontime';
			const el = meta.createSpan({ cls: ['mtm-review', `is-${kind}`] });
			appendIcon(el, kind === 'ontime' ? 'circle-check' : kind === 'overdue' ? 'circle-alert' : 'circle-dashed');
			el.appendText(kind === 'ontime' ? b.reviewedAgo(r.daysSince ?? 0) : kind === 'overdue' ? b.reviewDue : b.notReviewed);
			setTooltip(el, r.daysSince === null ? b.neverReviewed : b.reviewedAgo(r.daysSince));
		}
	}
	// Always shown while the Inbox has open Actions (unlike "Mark as reviewed", which shows on hover).
	if (m.isInbox && lane.openCount > 0) {
		const button = header.createEl('button', { cls: 'mtm-process-button' });
		appendIcon(button, 'list-checks');
		button.appendText(STRINGS.process.laneButton);
		button.addEventListener('click', () => h.processInbox());
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
		// Clicking anywhere in a collapsed lane's cells expands it; the dots still select their Action.
		cell.addEventListener('click', () => h.toggleLane(lane.matter.path));
		if (!cards.length) return;
		const dots = cell.createDiv({ cls: 'mtm-lane-dots' });
		for (const item of cards) {
			const dot = dots.createSpan({ cls: ['mtm-lane-dot', ...typeClasses(item.effective.type)], attr: { 'data-path': item.path } });
			setTooltip(dot, item.title);
			dot.addEventListener('click', (e) => {
				e.stopPropagation();
				h.select(item.path);
			});
		}
		return;
	}
	for (const item of cards) {
		const card = renderCard(cell, item, { now: input.now, selected: item.path === input.selected, onDismiss: (i) => h.dismiss(i) });
		bindCardActions(card, item.path, h);
	}
	if (lane.noNextAction && column.id === input.nextStepId) {
		nextStepGhost(cell, () => h.newAction(column.id, lane.matter.path));
	} else if (!closedColumn && lane.matter.state !== 'closed') {
		const add = pressable(cell.createDiv({ cls: 'mtm-cell-add' }), () => h.newAction(column.id, lane.matter.path));
		appendIcon(add, 'plus');
		add.appendText(STRINGS.board.addAction);
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

	const renderLane = (lane: BoardLane) => {
		renderLaneHeader(board, lane, h);
		for (const column of model.columns) renderCell(board, lane, column, input, h);
	};
	if (!model.bands) {
		model.lanes.forEach((lane, i) => {
			const inbox = lane.matter.isInbox;
			if (inbox && i > 0) board.createDiv({ cls: 'mtm-lane-sep' });
			renderLane(lane);
			if (inbox && i === 0 && model.lanes.length > 1) board.createDiv({ cls: 'mtm-lane-sep' });
		});
		return scroll;
	}

	board.addClass('has-spheres');
	const inbox = model.lanes.find((l) => l.matter.isInbox);
	const inboxFirst = !!inbox && model.lanes[0] === inbox;
	if (inbox && inboxFirst) {
		renderLane(inbox);
		if (model.bands.length) board.createDiv({ cls: 'mtm-lane-sep' });
	}
	for (const band of model.bands) {
		renderBand(board, band, model, h);
		if (!band.collapsed) band.lanes.forEach(renderLane);
	}
	if (inbox && !inboxFirst) {
		if (model.bands.length) board.createDiv({ cls: 'mtm-lane-sep' });
		renderLane(inbox);
	}
	return scroll;
}

/** A Sphere band: a full-width row above its lanes, with the Sphere's count in every column. */
function renderBand(board: HTMLElement, band: BoardBand, model: BoardModel, h: BoardHandlers): void {
	const key = band.sphere?.id ?? NO_SPHERE;
	const el = board.createDiv({
		cls: ['mtm-sphere-band', ...(band.sphere ? [] : ['mod-none']), ...(band.collapsed ? ['is-collapsed'] : [])],
		attr: { 'data-sphere': key },
	});
	const head = el.createDiv({ cls: 'mtm-sphere-head' });
	const toggle = pressable(head.createSpan({ cls: 'mtm-lane-toggle', attr: { 'aria-label': STRINGS.board.collapse } }), () => h.toggleBand(key));
	appendIcon(toggle, 'chevron-down');
	tileEl(head, band.sphere?.icon ?? NO_SPHERE_ICON, 'mod-neutral');
	pressable(head.createSpan({ cls: 'mtm-sphere-title', text: band.sphere?.label ?? STRINGS.spheres.none }), () => h.toggleBand(key));
	const menu = head.createDiv({ cls: 'clickable-icon mtm-lane-menu', attr: { 'aria-label': STRINGS.spheres.menu } });
	appendIcon(menu, 'ellipsis');
	menu.addEventListener('click', (e) => h.bandMenu(band, e, menu));

	for (const column of model.columns) {
		const entry = band.counts.byStatus.get(column.id);
		const cell = el.createDiv({ cls: ['mtm-sphere-count', ...statusClasses(column)] });
		if (!entry) continue;
		cell.createSpan({ cls: 'mtm-status-dot' });
		cell.appendText(String(entry.count));
		if (entry.late) {
			const late = cell.createSpan({ cls: 'mtm-sphere-late' });
			appendIcon(late, 'circle-alert');
			late.appendText(String(entry.late));
		}
		setTooltip(cell, STRINGS.spheres.columnTitle(entry.count, column.label, entry.late));
	}
}
