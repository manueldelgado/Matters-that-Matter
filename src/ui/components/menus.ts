// Status, type and Sphere menus: the non-drag way to move an Action or a Matter, shared by the views and the note banner.

import { Menu } from 'obsidian';
import type { SphereDef, StatusCategory, StatusDef, TypeDef } from '../../settings';
import { STRINGS } from '../../strings';
import { backlogStatus, doneStatus } from '../../model/workflow';
import { statusChip, tileEl, typeClasses } from './dom';

function showUnder(menu: Menu, anchor: HTMLElement | { x: number; y: number }): void {
	if (!('getBoundingClientRect' in anchor)) {
		menu.showAtPosition(anchor);
		return;
	}
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

/** Every Sphere with its icon, then "No Sphere"; under an element, or at a point (after another menu). */
export function showSphereMenu(
	anchor: HTMLElement | { x: number; y: number },
	spheres: readonly SphereDef[],
	currentId: string | null,
	onPick: (sphereId: string | null) => void,
): void {
	const menu = new Menu().setUseNativeMenu(false);
	const options: [string | null, string, string][] = [...spheres.map((s): [string, string, string] => [s.id, s.label, s.icon]), [null, STRINGS.spheres.none, 'circle-dashed']];
	options.forEach(([id, label, icon], i) => {
		if (i === spheres.length) menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(
					createFragment((f) => {
						const row = f.createSpan({ cls: 'mtm-menu-type' });
						tileEl(row, icon, 'mod-sm mod-neutral');
						row.appendText(label);
					}),
				)
				.setChecked(id === currentId)
				.onClick(() => {
					if (id !== currentId) onPick(id);
				}),
		);
	});
	showUnder(menu, anchor);
}
