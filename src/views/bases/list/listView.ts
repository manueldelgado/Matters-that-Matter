// The list: a custom Bases view. Rows grouped by Matter in lane order, or by type; Bases decides which Actions are rows.

import type { QueryController } from 'obsidian';
import type MattersPlugin from '../../../main';
import { toHm, toYmd } from '../../../model/dates';
import type { ActionItem } from '../../../services/actionItems';
import { VIEW_TYPES } from '../../../services/baseFile';
import { buildBoard } from '../../../services/boardModel';
import { buildListLayout, buildTypeGroups } from '../../../services/listModel';
import { focusedSphere } from '../../../services/spheres';
import { nextStepStatus } from '../../../services/nextAction';
import { showNoNextActionMenu, showStatusMenu } from '../../../ui/components/menus';
import { moveAction } from '../../../vault/actionWrites';
import { allMatters } from '../../../vault/index';
import { setMatterState } from '../../../vault/matterWrites';
import { renderEmpty } from '../board/boardRender';
import { CollectionView, OPTION_KEYS } from '../collectionView';
import { backlogStatus } from '../../../model/workflow';
import { renderToolbar } from '../toolbar';
import { renderList, type ListHandlers } from './listRender';

export class ListView extends CollectionView {
	readonly type = VIEW_TYPES.list;
	/** The Sphere the list is focused on, for new Matters typed in quick add. */
	private sphereFocus: string | null = null;

	constructor(controller: QueryController, containerEl: HTMLElement, plugin: MattersPlugin) {
		super(controller, containerEl, plugin);
	}

	protected refresh(force: boolean): void {
		const { settings } = this.plugin;
		if (!this.ready || !settings.setupDone) return;
		const now = new Date();
		const today = toYmd(now);
		const options = this.collectionOptions();
		const groupBy = this.config.get(OPTION_KEYS.groupBy) === 'type' ? 'type' : 'matter';
		const showBacklog = this.config.get(OPTION_KEYS.showBacklog) !== false;
		const backlog = backlogStatus(settings.statuses);
		const actions = this.actions();
		const matters = allMatters(this.plugin.app, settings, today);
		const timedToday = actions.some((a) => a.category !== 'closed' && a.due?.time && a.due.date === today);

		const signature = JSON.stringify([
			today,
			timedToday ? toHm(now) : '',
			settings.statuses,
			settings.types,
			settings.spheres,
			{ ...options, typesOff: [...options.typesOff], spheresOff: [...options.spheresOff], spheresCollapsed: [...options.spheresCollapsed] },
			groupBy,
			showBacklog,
			matters,
			actions.map((a) => [a.path, a.title, a.effective, a.priority, a.due, a.completed, a.waitingOn, a.waitingSince, a.linkedCount]),
		]);
		if (!force && signature === this.signature) return;
		this.signature = signature;

		const board = buildBoard(
			actions,
			matters,
			settings.statuses,
			{ ...options, hideEmptyLanes: true, laneToggles: {}, spheres: settings.spheres, showBacklog },
			today,
			now,
		);
		const focus = focusedSphere(options.spheresOff, board.sphereKeys);
		this.sphereFocus = focus;
		const previous = this.containerEl.querySelector('.mtm-scroll');
		const scroll = previous ? { left: previous.scrollLeft, top: previous.scrollTop } : null;

		this.containerEl.empty();
		const view = this.containerEl.createDiv({ cls: 'mtm-view' });
		renderToolbar(
			view,
			{
				types: settings.types,
				typesOff: options.typesOff,
				spheres: this.sphereChips(matters, actions, options.spheresOff),
				showDone: options.showDone,
				backlog: backlog ? { label: backlog.label, shown: showBacklog } : undefined,
				openCount: board.empty ? null : board.openCount,
			},
			{
				toggleType: (id) => this.toggleType(id),
				toggleSphere: (key) => this.toggleSphere(key),
				toggleDone: () => this.toggleDone(),
				toggleBacklog: () => this.toggleBacklog(showBacklog),
				newAction: () => this.plugin.quickAdd({ sphereId: focus }),
			},
		);
		if (board.empty) {
			renderEmpty(view, { newAction: () => this.plugin.quickAdd({ sphereId: focus }), newMatter: () => this.plugin.newMatter(focus) });
			return;
		}
		const scrollEl = renderList(
			view,
			{
				layout: buildListLayout(board),
				byType: groupBy === 'type' ? buildTypeGroups(board, settings.types) : null,
				matters: new Map(matters.map((m) => [m.path, m])),
				selected: this.plugin.selection.path,
				now,
				nextStepId: nextStepStatus(settings.statuses)?.id ?? null,
			},
			this.handlers,
		);
		if (scroll) {
			scrollEl.scrollLeft = scroll.left;
			scrollEl.scrollTop = scroll.top;
		}
	}

	/** On by default: showing the backlog again clears the option. */
	private toggleBacklog(shown: boolean): void {
		this.config.set(OPTION_KEYS.showBacklog, shown ? false : null);
		this.refresh(false);
	}

	/** The list's way to move an Action without dragging: every status, then Mark as done or Reopen. */
	private statusMenu(item: ActionItem, chip: HTMLElement): void {
		const { settings } = this.plugin;
		showStatusMenu(chip, settings.statuses, { statusId: item.effective.status.id, category: item.category }, (statusId) =>
			void this.write(item.path, (file) => moveAction(this.plugin.app, file, { statusId }, settings)),
		);
	}

	private handlers: ListHandlers = {
		openMatter: (path) => void this.plugin.openMatter(path),
		newAction: (matterPath, statusId) => this.plugin.quickAdd({ matterPath, statusId }),
		newTypedAction: (typeId) => this.plugin.quickAdd({ typeId, sphereId: this.sphereFocus }),
		noNextActionMenu: (lane, anchor) => {
			const m = lane.matter;
			showNoNextActionMenu(anchor, {
				matterName: m.name,
				newAction: () => this.plugin.quickAdd({ matterPath: m.path, statusId: nextStepStatus(this.plugin.settings.statuses)?.id }),
				markDormant: () => void this.write(m.path, (f) => setMatterState(this.plugin.app, f, 'dormant')),
				openOverview: () => void this.plugin.openMatter(m.path),
			});
		},
		statusMenu: (item, chip) => this.statusMenu(item, chip),
		select: (path) => this.select(path),
		open: (path, e) => this.open(path, e),
		dismiss: (item) => this.dismiss(item),
		toggleSection: (key) => this.toggleSphereCollapsed(key),
	};
}
