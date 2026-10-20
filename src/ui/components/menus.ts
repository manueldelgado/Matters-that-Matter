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

/** A menu of every status in workflow order, with its dot, the current one ticked. */
function statusItems(statuses: readonly StatusDef[], currentId: string, onPick: (statusId: string) => void): Menu {
	// The status dots carry each status's tone; a native menu would show plain text.
	const menu = new Menu().setUseNativeMenu(false);
	for (const status of statuses) {
		menu.addItem((i) =>
			i
				.setTitle(createFragment((f) => statusChip(f.createSpan(), status)))
				.setChecked(status.id === currentId)
				.onClick(() => onPick(status.id)),
		);
	}
	return menu;
}

/**
 * The status a new Action will get (quick add): every status and nothing else, since choosing the done status says
 * what "Mark as done" would. Picking the current one counts too: it turns a default into a choice.
 */
export function showStatusPicker(
	anchor: HTMLElement,
	statuses: readonly StatusDef[],
	currentId: string,
	onPick: (statusId: string) => void,
	onHide: () => void,
): void {
	const menu = statusItems(statuses, currentId, onPick);
	menu.onHide(onHide);
	showUnder(menu, anchor);
}

/** Every status, then Mark as done or Reopen. */
export function showStatusMenu(
	anchor: HTMLElement | { x: number; y: number },
	statuses: readonly StatusDef[],
	current: { statusId: string; category: StatusCategory },
	onPick: (statusId: string) => void,
	/** Items added after Mark as done / Reopen (the swipe board's "Move to Matter…"). */
	extra?: (menu: Menu) => void,
): void {
	const menu = statusItems(statuses, current.statusId, (statusId) => {
		if (statusId !== current.statusId) onPick(statusId);
	});
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
	if (extra) {
		menu.addSeparator();
		extra(menu);
	}
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

export interface NoNextActionMenu {
	matterName: string;
	newAction(): void;
	markDormant(): void;
	openOverview(): void;
}

/** The "No next Action" hint's menu: the two ways out, then the overview. */
export function showNoNextActionMenu(anchor: HTMLElement, m: NoNextActionMenu): void {
	const s = STRINGS.nextAction;
	const menu = new Menu();
	menu.addItem((i) => i.setTitle(s.newIn(m.matterName)).setIcon('plus').onClick(() => m.newAction()));
	menu.addItem((i) => i.setTitle(s.markDormant).setIcon('moon').onClick(() => m.markDormant()));
	menu.addSeparator();
	menu.addItem((i) => i.setTitle(s.openOverview).setIcon('layout-dashboard').onClick(() => m.openOverview()));
	anchor.addClass('is-active');
	menu.onHide(() => anchor.removeClass('is-active'));
	showUnder(menu, anchor);
}
