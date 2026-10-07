// The board: a custom Bases view. Lanes come from all Matter notes; Bases decides which Actions are cards.

import { BasesView, debounce, Keymap, Menu, normalizePath, Notice, TFile, type QueryController } from 'obsidian';
import type MattersPlugin from '../../../main';
import { STRINGS } from '../../../strings';
import { toHm, toYmd } from '../../../model/dates';
import { resolveInboxPosition, resolveShowDone } from '../../../model/actions';
import { moveLane, moveLaneBy, orderLanes } from '../../../model/matters';
import type { ActionItem } from '../../../services/actionItems';
import { buildBoard, type BoardLane, type BoardModel, type BoardOptions, type MatterInfo } from '../../../services/boardModel';
import { VIEW_TYPES } from '../../../services/baseFile';
import { actionItem, allMatters } from '../../../vault/index';
import { frontmatterOf } from '../../../vault/notes';
import { dismissOrphan, moveAction } from '../../../vault/actionWrites';
import { markReviewed, setMatterState, writeLaneOrders } from '../../../vault/matterWrites';
import { OPTION_KEYS } from '../registerViews';
import { attachDrag } from './boardDrag';
import { renderBoard, renderEmpty, renderToolbar, type BoardHandlers } from './boardRender';

/** Per-board state kept in the .base view config besides the declared options. */
const LANES_KEY = 'mtmLanes';
const TYPES_OFF_KEY = 'mtmTypesOff';
const CONFIG_DELAY = 800;

type LaneToggles = Record<string, 'collapsed' | 'expanded'>;

export class BoardView extends BasesView {
	readonly type = VIEW_TYPES.board;
	private signature = '';
	private model: BoardModel | null = null;
	private matters: MatterInfo[] = [];
	/** Toggles not yet written to the view config; they win over what the config says. */
	private pending: { lanes?: LaneToggles; typesOff?: string[] } = {};
	private flushConfig = debounce(() => this.writeConfig(), CONFIG_DELAY, true);
	/** Bases provides data and config from the first onDataUpdated on. */
	private ready = false;

	constructor(
		controller: QueryController,
		private containerEl: HTMLElement,
		private plugin: MattersPlugin,
	) {
		super(controller);
		this.registerEvent(plugin.events.on('settings-changed', () => this.refresh(true)));
		this.registerEvent(plugin.selection.on('changed', () => this.markSelection()));
		// Labels such as Today and overdue states change with the clock.
		this.registerInterval(window.setInterval(() => this.refresh(false), 60_000));
	}

	onDataUpdated(): void {
		this.ready = true;
		this.refresh(false);
	}

	onunload(): void {
		this.flushConfig.run();
	}

	// ——— Options ———

	private laneToggles(): LaneToggles {
		if (this.pending.lanes) return this.pending.lanes;
		const raw = this.config.get(LANES_KEY);
		const out: LaneToggles = {};
		if (raw && typeof raw === 'object') {
			for (const [path, v] of Object.entries(raw as Record<string, unknown>)) {
				if (v === 'collapsed' || v === 'expanded') out[path] = v;
			}
		}
		return out;
	}

	private typesOff(): string[] {
		if (this.pending.typesOff) return this.pending.typesOff;
		const raw = this.config.get(TYPES_OFF_KEY);
		return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
	}

	/** View options fall back to their declared defaults: config.get() returns nothing until changed. */
	private options(): BoardOptions {
		const s = this.plugin.settings;
		const days = Number(this.config.get(OPTION_KEYS.doneDays) ?? 0);
		return {
			inboxPosition: resolveInboxPosition(this.config.get(OPTION_KEYS.inboxPosition), s.defaultInboxPosition),
			showDone: resolveShowDone(this.config.get(OPTION_KEYS.showDone), s.showDone),
			doneDays: Number.isFinite(days) && days > 0 ? days : null,
			hideEmptyLanes: this.config.get(OPTION_KEYS.hideEmptyLanes) === true,
			typesOff: new Set(this.typesOff()),
			laneToggles: this.laneToggles(),
		};
	}

	/** Never called during a render: config.set() triggers onDataUpdated. */
	private writeConfig(): void {
		const { lanes, typesOff } = this.pending;
		if (lanes) this.config.set(LANES_KEY, Object.keys(lanes).length ? lanes : null);
		if (typesOff) this.config.set(TYPES_OFF_KEY, typesOff.length ? typesOff : null);
		this.pending = {};
	}

	// ——— Data and rendering ———

	private actions(): ActionItem[] {
		const { app } = this.plugin;
		const items: ActionItem[] = [];
		for (const entry of this.data.data) {
			const file = entry.file;
			if (frontmatterOf(app, file)?.['mtm-kind'] === 'action') items.push(actionItem(app, file, this.plugin.settings));
		}
		return items;
	}

	/** Re-renders only when what the board shows has changed. */
	private refresh(force: boolean): void {
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
		renderToolbar(view, input, this.handlers);
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

	private markSelection(): void {
		const selected = this.plugin.selection.path;
		this.containerEl.querySelectorAll<HTMLElement>('.mtm-card[data-path]').forEach((el) => {
			el.toggleClass('is-selected', el.dataset.path === selected);
		});
	}

	// ——— Actions ———

	private async write(path: string, fn: (file: TFile) => Promise<void>): Promise<void> {
		const file = this.plugin.app.vault.getFileByPath(path);
		if (!file) return;
		try {
			await fn(file);
		} catch (e) {
			console.error('Matters that Matter: write failed', e);
			new Notice(STRINGS.notices.writeFailed(e instanceof Error ? e.message : String(e)));
		}
	}

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
		toggleType: (typeId) => {
			const off = new Set(this.typesOff());
			if (off.has(typeId)) off.delete(typeId);
			else off.add(typeId);
			this.pending.typesOff = [...off];
			this.flushConfig();
			this.refresh(true);
		},
		toggleDone: () => {
			// Back to "inherit" when the board would match the global setting, so it follows later changes to it.
			const show = !this.options().showDone;
			this.config.set(OPTION_KEYS.showDone, show === this.plugin.settings.showDone ? null : show ? 'show' : 'hide');
			this.refresh(false);
		},
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
			this.pending.lanes = toggles;
			this.flushConfig();
			this.refresh(true);
		},
		newAction: (statusId, matterPath) => void this.plugin.newAction({ statusId, matterPath }),
		newMatter: () => this.plugin.newMatter(),
		openMatter: (path) => void this.plugin.openMatter(path),
		laneMenu: (lane, e, button) => this.openLaneMenu(lane, e, button),
		markReviewed: (path) => {
			const file = this.plugin.app.vault.getFileByPath(normalizePath(path));
			if (file) void markReviewed(this.plugin.app, file);
		},
		select: (path) => this.plugin.selection.set(path),
		open: (path, e) => {
			const file = this.plugin.app.vault.getFileByPath(path);
			if (!file) return;
			this.plugin.selection.set(path);
			const pane = e instanceof MouseEvent ? Keymap.isModEvent(e) : false;
			void this.plugin.app.workspace.getLeaf(pane || 'tab').openFile(file);
		},
		dismiss: (item) => void this.write(item.path, (file) => dismissOrphan(this.plugin.app, file, this.plugin.settings)),
	};
}
