// Status and type menus: the non-drag way to move an Action, shared by the list and the note banner.

import { Menu } from 'obsidian';
import type { StatusCategory, StatusDef, TypeDef } from '../../settings';
import { STRINGS } from '../../strings';
import { backlogStatus, doneStatus } from '../../model/workflow';
import { statusChip, tileEl, typeClasses } from './dom';

function showUnder(menu: Menu, anchor: HTMLElement): void {
	const rect = anchor.getBoundingClientRect();
	menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
}

/** Every status, then Mark as done or Reopen. */
export function showStatusMenu(
	anchor: HTMLElement,
	statuses: readonly StatusDef[],
	current: { statusId: string; category: StatusCategory },
	onPick: (statusId: string) => void,
): void {
	// The status dots carry each status's tone; a native menu would show plain text.
	const menu = new Menu().setUseNativeMenu(false);
	for (const status of statuses) {
		menu.addItem((i) =>
			i
				.setTitle(createFragment((f) => statusChip(f.createSpan(), status)))
				.setChecked(status.id === current.statusId)
				.onClick(() => {
					if (status.id !== current.statusId) onPick(status.id);
				}),
		);
	}
	menu.addSeparator();
	const closed = current.category === 'closed';
	const target = closed ? backlogStatus(statuses) : doneStatus(statuses);
	menu.addItem((i) =>
		i
			.setTitle(closed ? STRINGS.noteBanner.reopen : STRINGS.noteBanner.markDone)
			.setIcon(closed ? 'rotate-ccw' : 'circle-check')
			.setDisabled(!target)
			.onClick(() => target && onPick(target.id)),
	);
	showUnder(menu, anchor);
}

/** Every type with its tile. */
export function showTypeMenu(anchor: HTMLElement, types: readonly TypeDef[], currentId: string, onPick: (typeId: string) => void): void {
	const menu = new Menu().setUseNativeMenu(false);
	for (const type of types) {
		menu.addItem((i) =>
			i
				.setTitle(
					createFragment((f) => {
						const row = f.createSpan({ cls: ['mtm-menu-type', ...typeClasses(type)] });
						tileEl(row, type.icon, 'mod-sm');
						row.appendText(type.label);
					}),
				)
				.setChecked(type.id === currentId)
				.onClick(() => {
					if (type.id !== currentId) onPick(type.id);
				}),
		);
	}
	showUnder(menu, anchor);
}
