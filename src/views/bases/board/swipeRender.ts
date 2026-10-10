// The phone swipe board's DOM: Matter pills, the Matter's header, one Matter's columns, the "+". No state of its own.

import { setIcon, setTooltip } from 'obsidian';
import type { StatusDef } from '../../../settings';
import { STRINGS } from '../../../strings';
import type { BoardLane } from '../../../services/boardModel';
import type { SwipePill } from '../../../services/swipeModel';
import { bindCardActions, renderCard } from '../../../ui/components/card';
import { appendIcon, pressable, statusClasses, tileEl } from '../../../ui/components/dom';
import { nextStepGhost } from '../../../ui/components/nextAction';
import { NO_SPHERE_ICON } from '../collectionView';
import { processButton, renderLaneMeta, type BoardHandlers } from './boardRender';

export interface SwipeHandlers extends Pick<BoardHandlers, 'openMatter' | 'noNextActionMenu' | 'dismissSphere' | 'processInbox' | 'newAction' | 'select' | 'open' | 'dismiss'> {
	/** Shows another Matter. */
	choose(path: string): void;
	/** The board's lane menu, under the header's "⋯". */
	laneMenu(lane: BoardLane, e: MouseEvent, button: HTMLElement): void;
}

export interface SwipeInput {
	pills: SwipePill[];
	lane: BoardLane;
	columns: StatusDef[];
	/** The column for the next step, where the ghost card goes. */
	nextStepId: string | null;
	selected: string | null;
	now: Date;
}

export interface SwipeElements {
	pills: HTMLElement;
	board: HTMLElement;
	fab: HTMLElement;
}

export function renderSwipe(view: HTMLElement, input: SwipeInput, h: SwipeHandlers): SwipeElements {
	view.addClass('mod-swipe');
	const pills = renderPills(view, input, h);
	renderHead(view, input.lane, h);
	const board = renderColumns(view, input, h);
	const fab = view.createEl('button', { cls: 'mtm-fab', attr: { 'aria-label': STRINGS.swipe.newAction } });
	appendIcon(fab, 'plus');
	return { pills, board, fab };
}

function renderPills(view: HTMLElement, input: SwipeInput, h: SwipeHandlers): HTMLElement {
	const s = STRINGS.swipe;
	const strip = view.createDiv({ cls: 'mtm-matter-pills', attr: { role: 'tablist', 'aria-label': s.matters } });
	for (const p of input.pills) {
		const m = p.lane.matter;
		if (p.group !== undefined) {
			const label = strip.createSpan({ cls: 'mtm-matter-pills-label' });
			appendIcon(label, p.group?.icon ?? NO_SPHERE_ICON);
			label.appendText(p.group?.label ?? STRINGS.spheres.none);
		}
		const active = m.path === input.lane.matter.path;
		const pill = strip.createSpan({
			cls: ['mtm-matter-pill', ...(active ? ['is-active'] : []), ...(p.dim ? ['is-dim'] : [])],
			attr: { role: 'tab', 'aria-selected': String(active), 'data-path': m.path },
		});
		setIcon(pill.createSpan({ cls: 'mtm-matter-icon' }), m.icon);
		pill.appendText(m.name);
		if (p.signal?.kind === 'count') {
			const count = pill.createSpan({ cls: 'mtm-matter-pill-count', text: String(p.signal.n) });
			setTooltip(count, s.dueToday(p.signal.n));
		} else if (p.signal?.kind === 'review') {
			pill.createSpan({ cls: 'mtm-matter-pill-dot', attr: { 'aria-label': s.reviewDue } });
		}
		pressable(pill, () => {
			if (!active) h.choose(m.path);
		});
	}
	return strip;
}

/** One row with what the lane header carries on the board. */
function renderHead(view: HTMLElement, lane: BoardLane, h: SwipeHandlers): void {
	const m = lane.matter;
	const head = view.createDiv({ cls: 'mtm-swipe-head' });
	tileEl(head, m.icon, 'mod-neutral');
	const main = head.createDiv({ cls: 'mtm-swipe-head-main' });
	const title = pressable(main.createDiv({ cls: 'mtm-swipe-title', text: m.name }), () => h.openMatter(m.path));
	if (m.outcome) setTooltip(title, `${STRINGS.overview.outcome}: ${m.outcome}`);
	const meta = renderLaneMeta(main, lane, h);
	if (m.isInbox && lane.openCount > 0) processButton(meta, h);
	if (!m.isInbox) {
		const menu = head.createDiv({ cls: 'clickable-icon', attr: { 'aria-label': STRINGS.board.laneMenu } });
		appendIcon(menu, 'ellipsis');
		menu.addEventListener('click', (e) => h.laneMenu(lane, e, menu));
	}
}

function renderColumns(view: HTMLElement, input: SwipeInput, h: SwipeHandlers): HTMLElement {
	const { lane } = input;
	const board = view.createDiv({ cls: 'mtm-swipe-board' });
	for (const column of input.columns) {
		const cards = lane.cells.get(column.id) ?? [];
		const col = board.createDiv({ cls: 'mtm-swipe-col', attr: { 'data-status': column.id } });
		const head = col.createDiv({ cls: ['mtm-swipe-col-head', ...statusClasses(column)] });
		head.createSpan({ cls: 'mtm-status-dot' });
		head.appendText(column.label);
		head.createSpan({ cls: 'mtm-col-count', text: String(cards.length) });
		for (const item of cards) {
			const card = renderCard(col, item, { now: input.now, selected: item.path === input.selected, onDismiss: (i) => h.dismiss(i) });
			bindCardActions(card, item.path, h);
		}
		if (lane.noNextAction && column.id === input.nextStepId) nextStepGhost(col, () => h.newAction(column.id, lane.matter.path));
		else if (!cards.length) col.createDiv({ cls: 'mtm-empty', text: STRINGS.swipe.nothingHere });
	}
	return board;
}
