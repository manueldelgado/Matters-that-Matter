// Drag and drop on the board: cards between cells, lanes up and down and between Sphere bands.
// Listeners sit on the board scroll container, so a re-render replaces them with it.

const CARD_TYPE = 'application/x-mtm-action';
const LANE_TYPE = 'application/x-mtm-lane';

export interface DragHandlers {
	/** A card was dropped on another cell. */
	moveCard(path: string, matterPath: string, statusId: string): void;
	/**
	 * A lane was dropped before `beforePath`, or at the end when null, in the band of Sphere `sphereKey`
	 * (undefined when the board has no bands, or the drop was on the Inbox).
	 */
	moveLane(path: string, beforePath: string | null, sphereKey: string | undefined): void;
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

interface LaneDrop {
	/** The lane header the dragged lane goes before; null for the end. */
	before: HTMLElement | null;
	/** Where the marker goes when there is no `before` in the same band (a collapsed or empty band). */
	after: HTMLElement | null;
	/** The band's Sphere; undefined without bands or on the Inbox. */
	sphere: string | undefined;
}

/**
 * Where a dragged lane lands: before the lane under the pointer, or after it past its middle, in that lane's band.
 * Over a band's head: at the start of the band (or its end, when collapsed).
 */
function laneTarget(root: HTMLElement, target: HTMLElement, y: number): LaneDrop | null {
	const headers = laneHeaders(root);
	const band = target.closest<HTMLElement>('.mtm-sphere-band');
	if (band) {
		const sphere = band.dataset.sphere;
		const next = band.nextElementSibling;
		const first = next?.hasClass('mtm-lane-header') && !band.hasClass('is-collapsed') ? (next as HTMLElement) : null;
		if (first) return { before: first, after: null, sphere };
		// Collapsed: after every lane of the band, so before the next lane header in the board.
		const later = headers.find((h) => band.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING) ?? null;
		return { before: later, after: band, sphere };
	}
	const laneEl = target.closest<HTMLElement>('[data-lane]');
	const path = laneEl?.dataset.lane;
	if (!path) return null;
	const index = headers.findIndex((h) => h.dataset.lane === path);
	const header = headers[index];
	if (!header) return null;
	const sphere = header.dataset.sphere;
	const r = header.getBoundingClientRect();
	if (y < r.top + r.height / 2) return { before: header, after: null, sphere };
	return { before: headers[index + 1] ?? null, after: header, sphere };
}

/** The last element of a lane's or band's grid row: a lane header is followed by its cells. */
function afterRow(el: HTMLElement): HTMLElement {
	if (!el.hasClass('mtm-lane-header')) return el;
	let last = el;
	let next = el.nextElementSibling as HTMLElement | null;
	while (next?.hasClass('mtm-cell')) {
		last = next;
		next = next.nextElementSibling as HTMLElement | null;
	}
	return last;
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
			const drop = laneTarget(root, target, e.clientY);
			if (!drop) return;
			const marker = createDiv({ cls: 'mtm-lane-drop' });
			// Past the last lane of a band, the marker stays in that band (after the lane's cells).
			const sameBand = drop.before && drop.before.dataset.sphere === drop.sphere;
			if (drop.before && (sameBand || !drop.after)) drop.before.before(marker);
			else if (drop.after) afterRow(drop.after).after(marker);
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
			const drop = laneTarget(root, target, e.clientY);
			const beforePath = drop?.before?.dataset.lane ?? null;
			if (drop && beforePath !== lane) h.moveLane(lane, beforePath, drop.sphere);
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
