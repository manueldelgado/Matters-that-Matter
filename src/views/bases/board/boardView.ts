// The board: a custom Bases view. Lanes come from all Matter notes; Bases decides which Actions are cards.

import { Menu, normalizePath, type QueryController } from 'obsidian';
import type MattersPlugin from '../../../main';
import { STRINGS } from '../../../strings';
import { toHm, toYmd } from '../../../model/dates';
import { moveLane } from '../../../model/matters';
import { buildBoard, orderMatters, type BoardBand, type BoardLane, type BoardModel, type BoardOptions, type MatterInfo } from '../../../services/boardModel';
import { focusedSphere, NO_SPHERE } from '../../../services/spheres';
import { showNoNextActionMenu, showSphereMenu } from '../../../ui/components/menus';
import { nextStepStatus } from '../../../services/nextAction';
import { VIEW_TYPES } from '../../../services/baseFile';
import { allActionItems, allMatters } from '../../../vault/index';
import { moveAction } from '../../../vault/actionWrites';
import { markReviewed, setMatterSphere, setMatterState, writeLaneOrders } from '../../../vault/matterWrites';
import { CollectionView, OPTION_KEYS, SPHERES_OFF_KEY } from '../collectionView';
import { attachDrag } from './boardDrag';
import { renderToolbar, type SphereChip } from '../toolbar';
import { renderBoard, renderEmpty, type BoardHandlers } from './boardRender';

/** Per-board lane toggles kept in the .base view config besides the declared options. */
const LANES_KEY = 'mtmLanes';

type LaneToggles = Record<string, 'collapsed' | 'expanded'>;

export class BoardView extends CollectionView {
	readonly type = VIEW_TYPES.board;
	private model: BoardModel | null = null;
	private matters: MatterInfo[] = [];
	private chips: SphereChip[] = [];

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
			spheres: this.plugin.settings.spheres,
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
			settings.spheres,
			{ ...options, typesOff: [...options.typesOff], spheresOff: [...options.spheresOff], spheresCollapsed: [...options.spheresCollapsed] },
			this.matters,
			actions.map((a) => [a.path, a.title, a.effective, a.priority, a.start, a.due, a.completed, a.waitingOn, a.waitingSince, a.linkedCount]),
		]);
		if (!force && signature === this.signature) return;
		this.signature = signature;

		this.model = buildBoard(actions, this.matters, settings.statuses, options, today, now, allActionItems(this.plugin.app, settings));
		this.chips = this.sphereChips(this.matters, actions, options.spheresOff);
		this.render(this.model, options, now);
	}

	private render(model: BoardModel, options: BoardOptions, now: Date): void {
		const scroll = this.captureScroll('.mtm-board-scroll');

		this.containerEl.empty();
		const view = this.containerEl.createDiv({ cls: 'mtm-view' });
		const input = { model, types: this.plugin.settings.types, typesOff: options.typesOff, showDone: options.showDone, selected: this.plugin.selection.path, now, nextStepId: nextStepStatus(this.plugin.settings.statuses)?.id ?? null };
		renderToolbar(view, { ...input, statuses: this.plugin.settings.statuses, spheres: this.chips, openCount: model.empty ? null : model.openCount }, this.handlers);
		if (this.noActionsYet(model.empty)) {
			renderEmpty(view, this.handlers);
			return;
		}
		const scrollEl = renderBoard(view, input, this.handlers);
		attachDrag(scrollEl, {
			moveCard: (path, matterPath, statusId) => void this.write(path, (file) => moveAction(this.plugin.app, file, { matterPath, statusId }, this.plugin.settings)),
			moveLane: (path, beforePath, sphereKey) => void this.moveLaneBefore(path, beforePath, sphereKey, options),
		});
		this.restoreScroll(scrollEl, scroll);
	}

	// ——— Actions ———

	/** Matters other than the Inbox in board order (by Sphere, then lane order). */
	private nonInboxOrder(options: BoardOptions): MatterInfo[] {
		return orderMatters(this.matters, options.spheres, options.inboxPosition).filter((m) => !m.isInbox);
	}

	/** The single Sphere this board is focused on, for new Matters made from it. */
	private sphereFocus(): string | null {
		const options = this.options();
		return focusedSphere(options.spheresOff, this.model?.sphereKeys ?? []);
	}

	/**
	 * Moves a lane before another (or to the end), and into the Sphere of the band it was dropped in. Lane orders
	 * follow the board order, so each band keeps its own order.
	 */
	private async moveLaneBefore(path: string, beforePath: string | null, sphereKey: string | undefined, options: BoardOptions): Promise<void> {
		const { app } = this.plugin;
		const matter = this.matters.find((m) => m.path === path);
		const file = app.vault.getFileByPath(path);
		if (!matter || !file) return;
		let ordered = this.nonInboxOrder(options);
		if (options.spheres.length && sphereKey !== undefined) {
			const sphereId = sphereKey === NO_SPHERE ? null : sphereKey;
			if (sphereId !== matter.sphere) {
				await this.write(path, (f) => setMatterSphere(app, f, sphereId));
				// Order as it will be once the Matter is in its new Sphere.
				ordered = orderMatters(
					this.matters.map((m) => (m.path === path ? { ...m, sphere: sphereId } : m)),
					options.spheres,
					options.inboxPosition,
				).filter((m) => !m.isInbox);
			}
		}
		const rest = ordered.filter((m) => m.path !== path);
		const before = this.matters.find((m) => m.path === beforePath);
		let index = rest.length;
		if (before?.isInbox) index = options.inboxPosition === 'top' ? 0 : rest.length;
		else if (beforePath) index = Math.max(0, rest.findIndex((m) => m.path === beforePath));
		await writeLaneOrders(app, moveLane(ordered, path, index));
	}

	/** Moves a lane up or down within its band. */
	private async moveWithinBand(m: MatterInfo, delta: -1 | 1, options: BoardOptions): Promise<void> {
		const ordered = this.nonInboxOrder(options);
		const band = ordered.filter((x) => x.sphere === m.sphere || !options.spheres.length);
		const i = band.findIndex((x) => x.path === m.path);
		const neighbour = band[i + delta];
		if (!neighbour) return;
		const to = ordered.findIndex((x) => x.path === neighbour.path);
		await writeLaneOrders(this.plugin.app, moveLane(ordered, m.path, to));
	}

	private openLaneMenu(lane: BoardLane, e: MouseEvent, button: HTMLElement): void {
		const b = STRINGS.board;
		const m = lane.matter;
		const options = this.options();
		const band = this.nonInboxOrder(options).filter((x) => x.sphere === m.sphere || !options.spheres.length);
		const index = band.findIndex((x) => x.path === m.path);
		const file = this.plugin.app.vault.getFileByPath(m.path);
		const menu = new Menu();
		menu.addItem((i) => i.setTitle(b.moveUp).setIcon('arrow-up').setDisabled(index <= 0).onClick(() => void this.moveWithinBand(m, -1, options)));
		menu.addItem((i) =>
			i
				.setTitle(b.moveDown)
				.setIcon('arrow-down')
				.setDisabled(index < 0 || index >= band.length - 1)
				.onClick(() => void this.moveWithinBand(m, 1, options)),
		);
		if (options.spheres.length) {
			menu.addItem((i) =>
				i
					.setTitle(`${STRINGS.spheres.moveTo}…`)
					.setIcon('orbit')
					.setDisabled(!file)
					.onClick(() =>
						showSphereMenu({ x: e.clientX, y: e.clientY }, options.spheres, m.sphere, (sphereId) => {
							if (file) void this.write(m.path, (f) => setMatterSphere(this.plugin.app, f, sphereId));
						}),
					),
			);
		}
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

	/** Show only this Sphere (or all again), move it up or down in settings, and a new Matter in it. */
	private openBandMenu(band: BoardBand, e: MouseEvent, button: HTMLElement): void {
		const sp = STRINGS.spheres;
		const b = STRINGS.board;
		const key = band.sphere?.id ?? NO_SPHERE;
		const keys = this.model?.sphereKeys ?? [];
		const options = this.options();
		const onlyThis = keys.every((k) => (k === key) !== options.spheresOff.has(k));
		const menu = new Menu();
		menu.addItem((i) =>
			i
				.setTitle(onlyThis ? sp.showAll : sp.showOnly(band.sphere?.label ?? sp.none))
				.setIcon(onlyThis ? 'eye' : 'focus')
				.onClick(() => {
					if (onlyThis) {
						this.setConfigSoon(SPHERES_OFF_KEY, null);
						this.refresh(true);
					} else this.showOnlySphere(key, keys);
				}),
		);
		const sphere = band.sphere;
		if (sphere) {
			const spheres = this.plugin.settings.spheres;
			const index = spheres.findIndex((s) => s.id === sphere.id);
			const move = (delta: -1 | 1) => {
				const next = [...spheres];
				const [item] = next.splice(index, 1);
				if (!item) return;
				next.splice(index + delta, 0, item);
				this.plugin.settings.spheres = next;
				void this.plugin.saveSettings();
			};
			menu.addItem((i) => i.setTitle(b.moveUp).setIcon('arrow-up').setDisabled(index <= 0).onClick(() => move(-1)));
			menu.addItem((i) => i.setTitle(b.moveDown).setIcon('arrow-down').setDisabled(index < 0 || index >= spheres.length - 1).onClick(() => move(1)));
		}
		menu.addSeparator();
		menu.addItem((i) =>
			i
				.setTitle(sphere ? sp.newMatterIn(sphere.label) : b.newMatter)
				.setIcon('folder-plus')
				.onClick(() => this.plugin.newMatter(sphere?.id ?? null)),
		);
		button.addClass('is-active');
		menu.onHide(() => button.removeClass('is-active'));
		menu.showAtMouseEvent(e);
	}

	private handlers: BoardHandlers = {
		toggleType: (typeId) => this.toggleType(typeId),
		toggleSphere: (key) => this.toggleSphere(key),
		toggleDone: () => this.toggleDone(),
		toggleBand: (key) => this.toggleSphereCollapsed(key),
		bandMenu: (band, e, button) => this.openBandMenu(band, e, button),
		dismissSphere: (path) => void this.write(path, (f) => setMatterSphere(this.plugin.app, f, null)),
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
		newAction: (statusId, matterPath) => this.plugin.quickAdd({ statusId, matterPath, sphereId: this.sphereFocus() }),
		newMatter: () => this.plugin.newMatter(this.sphereFocus()),
		openMatter: (path) => void this.plugin.openMatter(path),
		laneMenu: (lane, e, button) => this.openLaneMenu(lane, e, button),
		processInbox: () => this.plugin.processInbox(this.sphereFocus()),
		noNextActionMenu: (lane, anchor) => {
			const m = lane.matter;
			showNoNextActionMenu(anchor, {
				matterName: m.name,
				newAction: () => this.plugin.quickAdd({ statusId: nextStepStatus(this.plugin.settings.statuses)?.id, matterPath: m.path, sphereId: this.sphereFocus() }),
				markDormant: () => void this.write(m.path, (f) => setMatterState(this.plugin.app, f, 'dormant')),
				openOverview: () => void this.plugin.openMatter(m.path),
			});
		},
		markReviewed: (path) => {
			const file = this.plugin.app.vault.getFileByPath(normalizePath(path));
			if (file) void markReviewed(this.plugin.app, file);
		},
		select: (path) => this.select(path),
		open: (path, e) => this.open(path, e),
		dismiss: (item) => this.dismiss(item),
	};
}
