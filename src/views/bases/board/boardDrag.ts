// Drag and drop on the board: cards between cells, lanes up and down.
// Listeners sit on the board scroll container, so a re-render replaces them with it.

const CARD_TYPE = 'application/x-mtm-action';
const LANE_TYPE = 'application/x-mtm-lane';

export interface DragHandlers {
	/** A card was dropped on another cell. */
	moveCard(path: string, matterPath: string, statusId: string): void;
	/** A lane was dropped before `beforePath`, or at the end when null. */
	moveLane(path: string, beforePath: string | null): void;
}

function clearMarks(root: HTMLElement): void {
	root.querySelectorAll('.mtm-drop-placeholder, .mtm-lane-drop').forEach((el) => el.remove());
	root.querySelectorAll('.is-drop-target').forEach((el) => el.removeClass('is-drop-target'));
}

/** Contract: before the first card whose vertical midpoint is below the pointer, else before the add button. */
function placePlaceholder(cell: HTMLElement, y: number): void {
	const placeholder = cell.querySelector('.mtm-drop-placeholder') ?? createDiv({ cls: 'mtm-drop-placeholder' });
	const cards = Array.from(cell.querySelectorAll<HTMLElement>(':scope > .mtm-card:not(.is-dragging)'));
	const before = cards.find((c) => {
		const r = c.getBoundingClientRect();
		return r.top + r.height / 2 > y;
	});
	const anchor = before ?? cell.querySelector(':scope > .mtm-cell-add');
	if (anchor) cell.insertBefore(placeholder, anchor);
	else cell.appendChild(placeholder);
}

/** Lane headers in board order, with the lane each one belongs to. */
function laneHeaders(root: HTMLElement): HTMLElement[] {
	return Array.from(root.querySelectorAll<HTMLElement>('.mtm-lane-header'));
}

/** The lane before which a dragged lane lands: the lane under the pointer, or the next one past its middle. */
function laneTarget(root: HTMLElement, target: HTMLElement, y: number): HTMLElement | null {
	const laneEl = target.closest<HTMLElement>('[data-lane]');
	const path = laneEl?.dataset.lane;
	if (!path) return null;
	const headers = laneHeaders(root);
	const index = headers.findIndex((h) => h.dataset.lane === path);
	const header = headers[index];
	if (!header) return null;
	const r = header.getBoundingClientRect();
	return y < r.top + r.height / 2 ? header : (headers[index + 1] ?? null);
}

export function attachDrag(root: HTMLElement, h: DragHandlers): void {
	let card: { path: string; lane: string; status: string } | null = null;
	let lane: string | null = null;

	root.addEventListener('dragstart', (e) => {
		const target = e.target as HTMLElement;
		const handle = target.closest<HTMLElement>('.mtm-lane-handle');
		if (handle) {
			const header = handle.closest<HTMLElement>('.mtm-lane-header');
			lane = header?.dataset.lane ?? null;
			if (lane && header) {
				e.dataTransfer?.setData(LANE_TYPE, lane);
				if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
				e.dataTransfer?.setDragImage(header, 12, 12);
				header.addClass('is-dragging');
			}
			return;
		}
		const cardEl = target.closest<HTMLElement>('.mtm-card');
		const cell = cardEl?.closest<HTMLElement>('.mtm-cell');
		if (!cardEl?.dataset.path || !cell) return;
		card = { path: cardEl.dataset.path, lane: cell.dataset.lane ?? '', status: cell.dataset.status ?? '' };
		e.dataTransfer?.setData(CARD_TYPE, card.path);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
		cardEl.addClass('is-dragging');
	});

	root.addEventListener('dragover', (e) => {
		const target = e.target as HTMLElement;
		if (card) {
			const cell = target.closest<HTMLElement>('.mtm-cell');
			if (!cell) return;
			e.preventDefault();
			if (!cell.hasClass('is-drop-target')) {
				clearMarks(root);
				cell.addClass('is-drop-target');
			}
			if (!cell.hasClass('is-collapsed')) placePlaceholder(cell, e.clientY);
		} else if (lane) {
			e.preventDefault();
			root.querySelectorAll('.mtm-lane-drop').forEach((el) => el.remove());
			const before = laneTarget(root, target, e.clientY);
			const marker = createDiv({ cls: 'mtm-lane-drop' });
			if (before) before.before(marker);
			else root.querySelector('.mtm-board')?.appendChild(marker);
		}
	});

	root.addEventListener('dragleave', (e) => {
		const related = e.relatedTarget as Node | null;
		if (!related || !root.contains(related)) clearMarks(root);
	});

	root.addEventListener('drop', (e) => {
		const target = e.target as HTMLElement;
		if (card) {
			const cell = target.closest<HTMLElement>('.mtm-cell');
			const to = { lane: cell?.dataset.lane ?? '', status: cell?.dataset.status ?? '' };
			e.preventDefault();
			if (cell && (to.lane !== card.lane || to.status !== card.status)) h.moveCard(card.path, to.lane, to.status);
		} else if (lane) {
			e.preventDefault();
			const before = laneTarget(root, target, e.clientY);
			const beforePath = before?.dataset.lane ?? null;
			if (beforePath !== lane) h.moveLane(lane, beforePath);
		}
		clearMarks(root);
	});

	root.addEventListener('dragend', () => {
		card = null;
		lane = null;
		clearMarks(root);
		root.querySelectorAll('.is-dragging').forEach((el) => el.removeClass('is-dragging'));
	});
}
