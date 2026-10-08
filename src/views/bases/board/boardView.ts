// The board: a custom Bases view. Lanes come from all Matter notes; Bases decides which Actions are cards.

import { Menu, normalizePath, type QueryController } from 'obsidian';
import type MattersPlugin from '../../../main';
import { STRINGS } from '../../../strings';
import { toHm, toYmd } from '../../../model/dates';
import { moveLane, moveLaneBy, orderLanes } from '../../../model/matters';
import { buildBoard, type BoardLane, type BoardModel, type BoardOptions, type MatterInfo } from '../../../services/boardModel';
import { VIEW_TYPES } from '../../../services/baseFile';
import { allMatters } from '../../../vault/index';
import { moveAction } from '../../../vault/actionWrites';
import { markReviewed, setMatterState, writeLaneOrders } from '../../../vault/matterWrites';
import { CollectionView, OPTION_KEYS } from '../collectionView';
import { attachDrag } from './boardDrag';
import { renderToolbar } from '../toolbar';
import { renderBoard, renderEmpty, type BoardHandlers } from './boardRender';

/** Per-board lane toggles kept in the .base view config besides the declared options. */
const LANES_KEY = 'mtmLanes';

type LaneToggles = Record<string, 'collapsed' | 'expanded'>;

export class BoardView extends CollectionView {
	readonly type = VIEW_TYPES.board;
	private model: BoardModel | null = null;
	private matters: MatterInfo[] = [];

	constructor(controller: QueryController, containerEl: HTMLElement, plugin: MattersPlugin) {
		super(controller, containerEl, plugin);
	}

	// ——— Options ———

	private laneToggles(): LaneToggles {
		const raw = this.configValue(LANES_KEY);
		const out: LaneToggles = {};
		if (raw && typeof raw === 'object') {
			for (const [path, v] of Object.entries(raw as Record<string, unknown>)) {
				if (v === 'collapsed' || v === 'expanded') out[path] = v;
			}
		}
		return out;
	}

	private options(): BoardOptions {
		return {
			...this.collectionOptions(),
			hideEmptyLanes: this.config.get(OPTION_KEYS.hideEmptyLanes) === true,
			laneToggles: this.laneToggles(),
		};
	}

	// ——— Data and rendering ———

	/** Re-renders only when what the board shows has changed. */
	protected refresh(force: boolean): void {
		const { settings } = this.plugin;
		if (!this.ready || !settings.setupDone) return;
		const now = new Date();
		const today = toYmd(now);
		const options = this.options();
		const actions = this.actions();
		this.matters = allMatters(this.plugin.app, settings, today);
		const timedToday = actions.some((a) => a.category !== 'closed' && a.due?.time && a.due.date === today);

		const signature = JSON.stringify([
			today,
			timedToday ? toHm(now) : '',
			settings.statuses,
			settings.types,
			{ ...options, typesOff: [...options.typesOff] },
			this.matters,
			actions.map((a) => [a.path, a.title, a.effective, a.priority, a.start, a.due, a.completed, a.waitingOn, a.linkedCount]),
		]);
		if (!force && signature === this.signature) return;
		this.signature = signature;

		this.model = buildBoard(actions, this.matters, settings.statuses, settings.types.map((t) => t.id), options, today);
		this.render(this.model, options, now);
	}

	private render(model: BoardModel, options: BoardOptions, now: Date): void {
		const previous = this.containerEl.querySelector('.mtm-board-scroll');
		const scroll = previous ? { left: previous.scrollLeft, top: previous.scrollTop } : null;

		this.containerEl.empty();
		const view = this.containerEl.createDiv({ cls: 'mtm-view' });
		const input = { model, types: this.plugin.settings.types, typesOff: options.typesOff, showDone: options.showDone, selected: this.plugin.selection.path, now };
		renderToolbar(view, { ...input, openCount: model.empty ? null : model.openCount }, this.handlers);
		if (model.empty) {
			renderEmpty(view, this.handlers);
			return;
		}
		const scrollEl = renderBoard(view, input, this.handlers);
		attachDrag(scrollEl, {
			moveCard: (path, matterPath, statusId) => void this.write(path, (file) => moveAction(this.plugin.app, file, { matterPath, statusId }, this.plugin.settings)),
			moveLane: (path, beforePath) => void this.moveLaneBefore(path, beforePath, options),
		});
		if (scroll) {
			scrollEl.scrollLeft = scroll.left;
			scrollEl.scrollTop = scroll.top;
		}
	}

	// ——— Actions ———

	private nonInboxOrder(options: BoardOptions): MatterInfo[] {
		return (orderLanes(this.matters, options.inboxPosition) as MatterInfo[]).filter((m) => !m.isInbox);
	}

	private async moveLaneBefore(path: string, beforePath: string | null, options: BoardOptions): Promise<void> {
		const ordered = this.nonInboxOrder(options);
		const rest = ordered.filter((m) => m.path !== path);
		const before = this.matters.find((m) => m.path === beforePath);
		let index = rest.length;
		if (before?.isInbox) index = options.inboxPosition === 'top' ? 0 : rest.length;
		else if (beforePath) index = Math.max(0, rest.findIndex((m) => m.path === beforePath));
		await writeLaneOrders(this.plugin.app, moveLane(ordered, path, index));
	}

	private openLaneMenu(lane: BoardLane, e: MouseEvent, button: HTMLElement): void {
		const b = STRINGS.board;
		const m = lane.matter;
		const options = this.options();
		const ordered = this.nonInboxOrder(options);
		const index = ordered.findIndex((x) => x.path === m.path);
		const file = this.plugin.app.vault.getFileByPath(m.path);
		const menu = new Menu();
		menu.addItem((i) =>
			i.setTitle(b.moveUp).setIcon('arrow-up').setDisabled(index <= 0).onClick(() => void writeLaneOrders(this.plugin.app, moveLaneBy(ordered, m.path, -1))),
		);
		menu.addItem((i) =>
			i
				.setTitle(b.moveDown)
				.setIcon('arrow-down')
				.setDisabled(index < 0 || index >= ordered.length - 1)
				.onClick(() => void writeLaneOrders(this.plugin.app, moveLaneBy(ordered, m.path, 1))),
		);
		menu.addSeparator();
		menu.addItem((i) =>
			i
				.setTitle(b.markReviewed)
				.setIcon('check')
				.setDisabled(!m.review || !file)
				.onClick(() => file && void markReviewed(this.plugin.app, file)),
		);
		const closed = m.state === 'closed';
		menu.addItem((i) =>
			i
				.setTitle(closed ? b.reopen : b.close)
				.setIcon(closed ? 'archive-restore' : 'archive')
				.setDisabled(!file)
				.onClick(() => file && void setMatterState(this.plugin.app, file, closed ? 'active' : 'closed')),
		);
		button.addClass('is-active');
		menu.onHide(() => button.removeClass('is-active'));
		menu.showAtMouseEvent(e);
	}

	private handlers: BoardHandlers = {
		toggleType: (typeId) => this.toggleType(typeId),
		toggleDone: () => this.toggleDone(),
		toggleLane: (path) => {
			const matter = this.matters.find((m) => m.path === path);
			const lane = this.model?.lanes.find((l) => l.matter.path === path);
			if (!matter || !lane) return;
			const toggles = { ...this.laneToggles() };
			const collapse = !lane.collapsed;
			// Store only what differs from the default for the Matter's state.
			const byDefault = matter.state !== 'active';
			if (collapse === byDefault) delete toggles[path];
			else toggles[path] = collapse ? 'collapsed' : 'expanded';
			this.setConfigSoon(LANES_KEY, Object.keys(toggles).length ? toggles : null);
			this.refresh(true);
		},
		newAction: (statusId, matterPath) => this.plugin.quickAdd({ statusId, matterPath }),
		newMatter: () => this.plugin.newMatter(),
		openMatter: (path) => void this.plugin.openMatter(path),
		laneMenu: (lane, e, button) => this.openLaneMenu(lane, e, button),
		markReviewed: (path) => {
			const file = this.plugin.app.vault.getFileByPath(normalizePath(path));
			if (file) void markReviewed(this.plugin.app, file);
		},
		select: (path) => this.select(path),
		open: (path, e) => this.open(path, e),
		dismiss: (item) => this.dismiss(item),
	};
}
