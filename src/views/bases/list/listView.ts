// The list: a custom Bases view. Rows grouped by Matter in lane order; Bases decides which Actions are rows.

import { Menu, type QueryController } from 'obsidian';
import type MattersPlugin from '../../../main';
import { STRINGS } from '../../../strings';
import { toHm, toYmd } from '../../../model/dates';
import { backlogStatus, doneStatus } from '../../../model/workflow';
import type { ActionItem } from '../../../services/actionItems';
import { VIEW_TYPES } from '../../../services/baseFile';
import { buildBoard } from '../../../services/boardModel';
import { buildList } from '../../../services/listModel';
import { statusChip } from '../../../ui/components/dom';
import { moveAction } from '../../../vault/actionWrites';
import { allMatters } from '../../../vault/index';
import { renderEmpty } from '../board/boardRender';
import { CollectionView } from '../collectionView';
import { renderToolbar } from '../toolbar';
import { renderList, type ListHandlers } from './listRender';

export class ListView extends CollectionView {
	readonly type = VIEW_TYPES.list;

	constructor(controller: QueryController, containerEl: HTMLElement, plugin: MattersPlugin) {
		super(controller, containerEl, plugin);
	}

	protected refresh(force: boolean): void {
		const { settings } = this.plugin;
		if (!this.ready || !settings.setupDone) return;
		const now = new Date();
		const today = toYmd(now);
		const options = this.collectionOptions();
		const actions = this.actions();
		const matters = allMatters(this.plugin.app, settings, today);
		const timedToday = actions.some((a) => a.category !== 'closed' && a.due?.time && a.due.date === today);

		const signature = JSON.stringify([
			today,
			timedToday ? toHm(now) : '',
			settings.statuses,
			settings.types,
			{ ...options, typesOff: [...options.typesOff] },
			matters,
			actions.map((a) => [a.path, a.title, a.effective, a.priority, a.due, a.completed, a.waitingOn, a.linkedCount]),
		]);
		if (!force && signature === this.signature) return;
		this.signature = signature;

		const board = buildBoard(
			actions,
			matters,
			settings.statuses,
			settings.types.map((t) => t.id),
			{ ...options, hideEmptyLanes: true, laneToggles: {} },
			today,
		);
		const previous = this.containerEl.querySelector('.mtm-scroll');
		const scroll = previous ? { left: previous.scrollLeft, top: previous.scrollTop } : null;

		this.containerEl.empty();
		const view = this.containerEl.createDiv({ cls: 'mtm-view' });
		renderToolbar(
			view,
			{ types: settings.types, typesOff: options.typesOff, showDone: options.showDone, openCount: board.empty ? null : board.openCount },
			{ toggleType: (id) => this.toggleType(id), toggleDone: () => this.toggleDone(), newAction: () => this.plugin.quickAdd() },
		);
		if (board.empty) {
			renderEmpty(view, { newAction: () => this.plugin.quickAdd(), newMatter: () => this.plugin.newMatter() });
			return;
		}
		const scrollEl = renderList(view, { groups: buildList(board), selected: this.plugin.selection.path, now }, this.handlers);
		if (scroll) {
			scrollEl.scrollLeft = scroll.left;
			scrollEl.scrollTop = scroll.top;
		}
	}

	/** The list's way to move an Action without dragging: every status, then Mark as done or Reopen. */
	private statusMenu(item: ActionItem, chip: HTMLElement): void {
		const { settings } = this.plugin;
		const move = (statusId: string) =>
			void this.write(item.path, (file) => moveAction(this.plugin.app, file, { statusId }, settings));
		// The status dots carry each status's tone; a native menu would show plain text.
		const menu = new Menu().setUseNativeMenu(false);
		for (const status of settings.statuses) {
			menu.addItem((i) => {
				const title = createFragment((f) => statusChip(f.createSpan(), status));
				i.setTitle(title)
					.setChecked(status.id === item.effective.status.id)
					.onClick(() => {
						if (status.id !== item.effective.status.id) move(status.id);
					});
			});
		}
		menu.addSeparator();
		const closed = item.category === 'closed';
		const target = closed ? backlogStatus(settings.statuses) : doneStatus(settings.statuses);
		menu.addItem((i) =>
			i
				.setTitle(closed ? STRINGS.list.reopen : STRINGS.list.markDone)
				.setIcon(closed ? 'rotate-ccw' : 'circle-check')
				.setDisabled(!target)
				.onClick(() => target && move(target.id)),
		);
		const rect = chip.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
	}

	private handlers: ListHandlers = {
		openMatter: (path) => void this.plugin.openMatter(path),
		newAction: (matterPath) => this.plugin.quickAdd({ matterPath }),
		statusMenu: (item, chip) => this.statusMenu(item, chip),
		select: (path) => this.select(path),
		open: (path, e) => this.open(path, e),
		dismiss: (item) => this.dismiss(item),
	};
}
