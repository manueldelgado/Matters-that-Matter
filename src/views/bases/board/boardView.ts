// The board: a custom Bases view. Lanes come from all Matter notes; Bases decides which Actions are cards.

import { FileView, Menu, normalizePath, Notice, type QueryController } from 'obsidian';
import type MattersPlugin from '../../../main';
import { STRINGS } from '../../../strings';
import { toHm, toYmd, type Ymd } from '../../../model/dates';
import { moveLane, startsCollapsed } from '../../../model/matters';
import { buildBoard, orderMatters, type BoardBand, type BoardLane, type BoardModel, type BoardOptions, type MatterInfo } from '../../../services/boardModel';
import { focusedSphere, NO_SPHERE } from '../../../services/spheres';
import { showNoNextActionMenu, showSphereMenu, showStatusMenu } from '../../../ui/components/menus';
import { nextStepStatus } from '../../../services/nextAction';
import { VIEW_TYPES } from '../../../services/baseFile';
import { allActionItems, allMatters } from '../../../vault/index';
import { moveAction } from '../../../vault/actionWrites';
import { markReviewed, setMatterSphere, setMatterState, writeLaneOrders } from '../../../vault/matterWrites';
import { CollectionView, OPTION_KEYS, SPHERES_COLLAPSED_KEY, SPHERES_OFF_KEY } from '../collectionView';
import { revealPlan } from '../../../services/reveal';
import type { ActionItem } from '../../../services/actionItems';
import { attachDrag } from './boardDrag';
import { renderToolbar, type SphereChip } from '../toolbar';
import { renderBoard, renderEmpty, type BoardHandlers } from './boardRender';
import { attachLongPress } from './longPress';
import { renderSwipe, type SwipeHandlers } from './swipeRender';
import { chosenPill, openingColumn, swipePills } from '../../../services/swipeModel';
import { MatterPicker } from '../../../ui/modals/matterPicker';

/** Per-board lane toggles kept in the .base view config besides the declared options. */
const LANES_KEY = 'mtmLanes';
/** The Matter the phone swipe board shows, kept the same way. */
const PHONE_MATTER_KEY = 'mtmPhoneMatter';
/** How long a revealed lane's header stays lit (the CSS animation's length). */
const SPOTLIGHT_MS = 1600;

type LaneToggles = Record<string, 'collapsed' | 'expanded'>;

export class BoardView extends CollectionView {
	readonly type = VIEW_TYPES.board;
	private model: BoardModel | null = null;
	private matters: MatterInfo[] = [];
	private chips: SphereChip[] = [];
	/** The swipe board's Matter: undefined until read from the view config. */
	private phoneMatter: string | null | undefined = undefined;
	/** Where the swipe board was scrolled, for the Matter it showed. */
	private swipeScroll: { path: string; left: number } | null = null;
	private visibleWaiter: ResizeObserver | null = null;
	/** A Matter whose lane header lights up after the next render (Show on board). */
	private spotlightPath: string | null = null;
	private spotlightTimer: number | null = null;

	constructor(controller: QueryController, containerEl: HTMLElement, plugin: MattersPlugin) {
		super(controller, containerEl, plugin);
		plugin.boards.add(this);
	}

	onunload(): void {
		this.plugin.boards.delete(this);
		this.visibleWaiter?.disconnect();
		this.clearSpotlight();
		super.onunload();
	}

	/** The Sphere this board is focused on when it sits inside `el` (the active tab); undefined when it doesn't. */
	focusWithin(el: HTMLElement): string | null | undefined {
		return this.isWithin(el) ? this.sphereFocus() : undefined;
	}

	/** Whether this board sits inside `el` (a tab's view). */
	isWithin(el: HTMLElement): boolean {
		return el.contains(this.containerEl);
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

		const reveal = this.takeReveal();
		if (reveal) this.reveal(reveal, actions, options, today, now);
		else this.spotlight();
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
		if (this.isPhone()) {
			this.renderSwipe(view, model, now);
			return;
		}
		const scrollEl = renderBoard(view, input, this.handlers);
		attachDrag(scrollEl, {
			moveCard: (path, matterPath, statusId) => void this.write(path, (file) => moveAction(this.plugin.app, file, { matterPath, statusId }, this.plugin.settings)),
			moveLane: (path, beforePath, sphereKey) => void this.moveLaneBefore(path, beforePath, sphereKey, options),
		});
		this.restoreScroll(scrollEl, scroll);
	}

	// ——— Show on board ———

	/** Renders now, so a reveal waiting for this board is taken (the board was already open). */
	revealNow(): void {
		this.refresh(true);
	}

	/** The .base file this board shows in its own tab; null when embedded in a note. */
	private boardFilePath(): string | null {
		for (const leaf of this.plugin.app.workspace.getLeavesOfType('bases')) {
			if (leaf.view instanceof FileView && leaf.view.containerEl.contains(this.containerEl)) return leaf.view.file?.path ?? null;
		}
		return null;
	}

	/** The Matter of a reveal waiting for this board's file, taken so no other view repeats it. */
	private takeReveal(): string | null {
		if (!this.plugin.hasPendingReveal()) return null;
		const path = this.boardFilePath();
		return path ? this.plugin.takeReveal(path) : null;
	}

	/**
	 * Brings a Matter's lane into view: its Sphere chip on, its band and lane expanded (stored as if clicked), then
	 * the lane header scrolled to the top left and lit once. A notice when the board can't show it as set up.
	 * Phones choose the Matter's pill instead.
	 */
	private reveal(path: string, actions: readonly ActionItem[], options: BoardOptions, today: Ymd, now: Date): void {
		const { settings } = this.plugin;
		if (!this.model || this.noActionsYet(this.model.empty)) return;
		// Built with every Sphere chip on, so a lane hidden only by its chip still shows whether it has cards.
		const unfocused = buildBoard(actions, this.matters, settings.statuses, { ...options, spheresOff: new Set() }, today, now);
		const plan = revealPlan(unfocused, options, path, this.matters);
		if (plan.blocked === 'hidden-empty') {
			const name = this.matters.find((m) => m.path === path)?.name ?? path;
			new Notice(STRINGS.reveal.hiddenEmpty(name));
			return;
		}
		if (plan.blocked === 'inbox-hidden') {
			new Notice(STRINGS.reveal.inboxHidden);
			return;
		}
		if (plan.blocked) return;

		const phone = this.isPhone();
		for (const step of plan.steps) {
			if (step.kind === 'sphere-on') this.setInList(SPHERES_OFF_KEY, step.key, false);
			// The swipe board shows one Matter whole: bands and collapsed lanes don't apply there.
			else if (phone) continue;
			else if (step.kind === 'expand-band') this.setInList(SPHERES_COLLAPSED_KEY, step.key, false);
			else this.setLaneCollapsed(step.path, false);
		}
		if (phone) {
			this.chooseMatter(path);
			return;
		}
		this.spotlightPath = path;
		if (plan.steps.length) this.refresh(true);
		else this.spotlight();
	}

	/**
	 * Scrolls the waiting lane's header to the board's top left, under the column headers, and lights it once. In a
	 * hidden tab it waits until the board is shown; the Matter stays waiting until then, so a render in between
	 * (which replaces the board's elements) arms it again, and the elements are looked up only when it runs.
	 */
	private spotlight(): void {
		const path = this.spotlightPath;
		if (!path) return;
		this.clearSpotlight();
		this.whenVisible(this.containerEl, () => {
			this.spotlightPath = null;
			const scroll = this.containerEl.querySelector<HTMLElement>('.mtm-board-scroll');
			const header = scroll?.querySelector<HTMLElement>(`.mtm-lane-header[data-lane="${CSS.escape(path)}"]`);
			if (!scroll || !header) return;
			// The header sticks to the left edge, so scrolling it into view alone leaves the board where it was sideways.
			scroll.scrollLeft = 0;
			header.scrollIntoView({ block: 'start', inline: 'nearest' });
			header.addClass('is-spotlit');
			this.spotlightTimer = window.setTimeout(() => {
				this.spotlightTimer = null;
				header.removeClass('is-spotlit');
			}, SPOTLIGHT_MS);
		});
	}

	private clearSpotlight(): void {
		if (this.spotlightTimer !== null) window.clearTimeout(this.spotlightTimer);
		this.spotlightTimer = null;
		this.containerEl.querySelectorAll('.mtm-lane-header.is-spotlit').forEach((el) => el.removeClass('is-spotlit'));
	}

	/** Stores a lane as collapsed or expanded, only where that differs from the default for its Matter's state. */
	private setLaneCollapsed(path: string, collapse: boolean): void {
		const matter = this.matters.find((m) => m.path === path);
		if (!matter) return;
		const toggles = { ...this.laneToggles() };
		if (collapse === startsCollapsed(matter.state)) delete toggles[path];
		else toggles[path] = collapse ? 'collapsed' : 'expanded';
		this.setConfigSoon(LANES_KEY, Object.keys(toggles).length ? toggles : null);
	}

	// ——— Phone swipe board ———

	/** Phones get the swipe board; tablets and desktops the board. */
	private isPhone(): boolean {
		return this.containerEl.ownerDocument.body.hasClass('is-phone');
	}

	private renderSwipe(view: HTMLElement, model: BoardModel, now: Date): void {
		const settings = this.plugin.settings;
		const pills = swipePills(model, now);
		if (this.phoneMatter === undefined) {
			const stored = this.configValue(PHONE_MATTER_KEY);
			this.phoneMatter = typeof stored === 'string' ? stored : null;
		}
		const chosen = chosenPill(pills, this.phoneMatter);
		if (!chosen) {
			view.createDiv({ cls: 'mtm-empty', text: STRINGS.swipe.nothingHere });
			return;
		}
		const lane = chosen.lane;
		const path = lane.matter.path;
		const nextStepId = nextStepStatus(settings.statuses)?.id ?? null;
		const els = renderSwipe(
			view,
			{ pills, lane, columns: model.columns, nextStepId, selected: this.plugin.selection.path, now },
			this.swipeHandlers,
		);
		// No drag on the swipe board: holding a card opens the move menu instead.
		els.board.querySelectorAll('.mtm-card').forEach((card) => card.setAttr('draggable', 'false'));
		attachLongPress(els.board, (p, at) => this.moveMenu(p, at));
		els.fab.addEventListener('click', () =>
			this.plugin.quickAdd({ matterPath: path, statusId: columnInView(els.board) ?? undefined, sphereId: this.sphereFocus() }),
		);

		// Same Matter: where the user was. Another Matter: its opening column. The active pill comes into view.
		const kept = this.swipeScroll?.path === path ? this.swipeScroll.left : null;
		const opening = openingColumn(lane, model.columns, nextStepId);
		this.whenVisible(els.board, () => {
			const col = opening ? els.board.querySelector<HTMLElement>(`[data-status="${CSS.escape(opening)}"]`) : null;
			els.board.scrollLeft = kept ?? (col ? els.board.scrollLeft + col.getBoundingClientRect().left - els.board.getBoundingClientRect().left : 0);
			const active = els.pills.querySelector<HTMLElement>('.mtm-matter-pill.is-active');
			if (active) els.pills.scrollLeft += active.getBoundingClientRect().left - els.pills.getBoundingClientRect().left - 48;
		});
		els.board.addEventListener(
			'scroll',
			() => {
				if (els.board.clientWidth > 0) this.swipeScroll = { path, left: els.board.scrollLeft };
			},
			{ passive: true },
		);
	}

	/** Runs `fn` now, or once a hidden tab is shown (a hidden element can't scroll). */
	private whenVisible(el: HTMLElement, fn: () => void): void {
		this.visibleWaiter?.disconnect();
		this.visibleWaiter = null;
		if (el.clientWidth > 0) {
			fn();
			return;
		}
		const waiter = new ResizeObserver(() => {
			if (el.clientWidth === 0) return;
			waiter.disconnect();
			this.visibleWaiter = null;
			fn();
		});
		this.visibleWaiter = waiter;
		waiter.observe(el);
	}

	private chooseMatter(path: string): void {
		this.phoneMatter = path;
		this.swipeScroll = null;
		this.setConfigSoon(PHONE_MATTER_KEY, path);
		this.refresh(true);
	}

	/** Long-press: every status, Mark as done or Reopen, then Move to Matter…. */
	private moveMenu(path: string, at: { x: number; y: number }): void {
		const item = this.model?.lanes.flatMap((l) => [...l.cells.values()].flat()).find((i) => i.path === path);
		if (!item) return;
		const { app } = this.plugin;
		const settings = this.plugin.settings;
		showStatusMenu(
			at,
			settings.statuses,
			{ statusId: item.effective.status.id, category: item.category },
			(statusId) => void this.write(path, (file) => moveAction(app, file, { statusId }, settings)),
			(menu) =>
				menu.addItem((i) =>
					i
						.setTitle(STRINGS.swipe.moveTo)
						.setIcon('folder-input')
						.onClick(() => {
							const targets = this.matters.filter((m) => m.state !== 'closed' && m.path !== item.effective.matterPath);
							new MatterPicker(app, orderMatters(targets, settings.spheres, settings.defaultInboxPosition), (m) =>
								void this.write(path, (file) => moveAction(app, file, { matterPath: m.path }, settings)),
							).open();
						}),
				),
		);
	}

	private swipeHandlers: SwipeHandlers = {
		choose: (path) => this.chooseMatter(path),
		openMatter: (path) => void this.plugin.openMatter(path),
		laneMenu: (lane, e, button) => this.openLaneMenu(lane, e, button),
		noNextActionMenu: (lane, anchor) => this.handlers.noNextActionMenu(lane, anchor),
		dismissSphere: (path) => this.handlers.dismissSphere(path),
		processInbox: () => this.handlers.processInbox(),
		newAction: (statusId, matterPath) => this.handlers.newAction(statusId, matterPath),
		select: (path) => this.select(path),
		open: (path, e) => this.open(path, e),
		dismiss: (item) => this.dismiss(item),
	};

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
		// A session of one; the Inbox has no reviews.
		if (!m.isInbox) {
			menu.addItem((i) =>
				i
					.setTitle(STRINGS.review.reviewNow)
					.setIcon('rotate-ccw')
					.setDisabled(!file || m.state === 'closed')
					.onClick(() => this.plugin.reviewMatters({ only: m.path })),
			);
		}
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
			const lane = this.model?.lanes.find((l) => l.matter.path === path);
			if (!lane || !this.matters.some((m) => m.path === path)) return;
			this.setLaneCollapsed(path, !lane.collapsed);
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

/** The status of the column most in view on the swipe board. */
function columnInView(board: HTMLElement): string | null {
	const left = board.getBoundingClientRect().left;
	let best: { id: string; d: number } | null = null;
	board.querySelectorAll<HTMLElement>('.mtm-swipe-col[data-status]').forEach((col) => {
		const d = Math.abs(col.getBoundingClientRect().left - left);
		const id = col.dataset.status;
		if (id && (!best || d < best.d)) best = { id, d };
	});
	return (best as { id: string; d: number } | null)?.id ?? null;
}

