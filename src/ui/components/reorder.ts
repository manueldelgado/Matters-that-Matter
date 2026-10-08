// Reorderable editor rows: drag by the handle, or click the handle for "Move up" / "Move down".

import { Menu } from 'obsidian';
import { STRINGS } from '../../strings';
import { appendIcon } from './dom';

/** Each list has its own drag type, so a status row can't be dropped on the type list. */
const rowType = (list: string) => `application/x-mtm-row-${list}`;

export function reorderable(
	row: HTMLElement,
	index: number,
	count: number,
	move: (from: number, to: number) => void,
	list: 'statuses' | 'types' | 'spheres',
): HTMLElement {
	const ROW_TYPE = rowType(list);
	const handle = row.createSpan({ cls: 'mtm-drag-handle' });
	appendIcon(handle, 'grip-vertical');
	handle.setAttr('aria-label', STRINGS.editors.dragHint);

	handle.addEventListener('click', (e) => {
		const menu = new Menu();
		menu.addItem((item) =>
			item.setTitle(STRINGS.editors.moveUp).setIcon('arrow-up').setDisabled(index === 0).onClick(() => move(index, index - 1)),
		);
		menu.addItem((item) =>
			item
				.setTitle(STRINGS.editors.moveDown)
				.setIcon('arrow-down')
				.setDisabled(index === count - 1)
				.onClick(() => move(index, index + 1)),
		);
		menu.showAtMouseEvent(e);
	});

	// Only the handle starts a drag, so text in the row stays selectable.
	handle.addEventListener('pointerdown', () => (row.draggable = true));
	row.addEventListener('dragstart', (e) => {
		e.dataTransfer?.setData(ROW_TYPE, String(index));
		row.addClass('is-dragging');
	});
	row.addEventListener('dragend', () => {
		row.draggable = false;
		row.removeClass('is-dragging');
	});
	row.addEventListener('dragover', (e) => {
		if (e.dataTransfer?.types.includes(ROW_TYPE)) e.preventDefault();
	});
	row.addEventListener('drop', (e) => {
		const from = Number(e.dataTransfer?.getData(ROW_TYPE));
		if (!Number.isInteger(from) || from === index) return;
		e.preventDefault();
		move(from, index);
	});
	return handle;
}
