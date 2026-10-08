// The timeline: a custom Bases view. Days across, Matters and their dated Actions down.

import { Keymap, type QueryController } from 'obsidian';
import type MattersPlugin from '../../../main';
import { STRINGS } from '../../../strings';
import { isShownByDone } from '../../../model/actions';
import { addDays, daysBetween, toYmd, type Ymd } from '../../../model/dates';
import type { ActionItem } from '../../../services/actionItems';
import { VIEW_TYPES } from '../../../services/baseFile';
import { orderMatters, typeShown } from '../../../services/boardModel';
import { buildTimeline, dragDates, openingDay, timelineRange, timelineSections, type DragEdge, type TimelineRange } from '../../../services/timelineModel';
import { editAction } from '../../../vault/actionWrites';
import { allMatters } from '../../../vault/index';
import { renderEmpty } from '../board/boardRender';
import { CollectionView } from '../collectionView';
import { renderToolbar } from '../toolbar';
import { rangeLabel, renderNav, renderTimeline, type TimelineHandlers } from './timelineRender';

const DAY_WIDTH = 30;
/** Pointer travel below this is a click, not a drag. */
const DRAG_THRESHOLD = 4;

export class TimelineView extends CollectionView {
	readonly type = VIEW_TYPES.timeline;
	private range: TimelineRange | null = null;
	/** The first day in view, kept across re-renders; null until the first render scrolls to the opening week. */
	private firstVisible: Ymd | null = null;
	private items: ActionItem[] = [];
	private scrollEl: HTMLElement | null = null;
	private rangeEl: HTMLElement | null = null;
	/** Set after a drag so the click that follows does not also select. */
	private suppressClick = false;
	/** Day width at the last scroll; when it changes (narrow layout), the same first day is scrolled back into view. */
	private lastDayWidth = 0;
	/** Keeps the same dates in view, and the dates label right, when the view is resized. */
	private resize = new ResizeObserver(() => {
		const width = this.dayWidth();
		if (this.lastDayWidth && width !== this.lastDayWidth && this.firstVisible) this.scrollToDay(this.firstVisible, false);
		this.lastDayWidth = width;
		this.updateRangeLabel();
	});

	constructor(controller: QueryController, containerEl: HTMLElement, plugin: MattersPlugin) {
		super(controller, containerEl, plugin);
	}

	protected refresh(force: boolean): void {
		const { app, settings } = this.plugin;
		if (!this.ready || !settings.setupDone) return;
		const now = new Date();
		const today = toYmd(now);
		const options = this.collectionOptions();
		const all = this.actions();
		const allMatterInfo = allMatters(app, settings, today);
		const matters = orderMatters(allMatterInfo, settings.spheres, options.inboxPosition).filter((m) =>
			this.matterShown(m, allMatterInfo, options.spheresOff),
		);
		const shownPaths = new Set(matters.map((m) => m.path));
		const items = all.filter(
			(a) =>
				typeShown(a.effective.type.id, options.typesOff) &&
				isShownByDone(a.category, a.completed, options.showDone, options.doneDays, today) &&
				shownPaths.has(a.effective.matterPath),
		);

		const signature = JSON.stringify([
			today,
			settings.statuses,
			settings.types,
			settings.weekStart,
			settings.spheres,
			{ ...options, typesOff: [...options.typesOff], spheresOff: [...options.spheresOff], spheresCollapsed: [...options.spheresCollapsed] },
			matters.map((m) => [m.path, m.name, m.icon, m.sphere]),
			items.map((a) => [a.path, a.title, a.effective, a.priority, a.start, a.due, a.completed, a.waitingOn]),
		]);
		if (!force && signature === this.signature) return;
		this.signature = signature;
		this.items = items;
		if (this.scrollEl && this.range) this.firstVisible = this.visibleDays().first;

		const range = timelineRange(today, settings.weekStart);
		this.range = range;
		const groups = buildTimeline(items, matters, range);
		const sections = settings.spheres.length ? timelineSections(groups, settings.spheres, options.spheresCollapsed) : null;
		const names = new Map(matters.map((m) => [m.path, m.name]));

		this.resize.disconnect();
		this.containerEl.empty();
		this.scrollEl = null;
		this.rangeEl = null;
		const view = this.containerEl.createDiv({ cls: 'mtm-view' });
		const openCount = all.filter((a) => a.category !== 'closed').length;
		renderToolbar(
			view,
			{
				types: settings.types,
				typesOff: options.typesOff,
				spheres: this.sphereChips(allMatterInfo, all, options.spheresOff),
				showDone: options.showDone,
				openCount: all.length ? openCount : null,
			},
			{
				toggleType: (id) => this.toggleType(id),
				toggleSphere: (key) => this.toggleSphere(key),
				toggleDone: () => this.toggleDone(),
				newAction: () => this.plugin.quickAdd(),
			},
		);
		if (!all.length) {
			renderEmpty(view, { newAction: () => this.plugin.quickAdd(), newMatter: () => this.plugin.newMatter() });
			return;
		}
		this.rangeEl = renderNav(view, this.handlers);
		if (!groups.length) {
			view.createDiv({ cls: 'mtm-scroll' }).createDiv({ cls: 'mtm-empty', text: STRINGS.timeline.noDated });
			this.rangeEl.setText('');
			return;
		}
		const { scroll, timeline } = renderTimeline(
			view,
			{
				range,
				groups,
				sections,
				weekStart: settings.weekStart,
				today,
				selected: this.plugin.selection.path,
				matterName: (path) => names.get(path) ?? path.split('/').pop()?.replace(/\.md$/i, '') ?? path,
			},
			this.handlers,
		);
		this.scrollEl = scroll;
		this.lastDayWidth = this.dayWidth();
		this.scrollToDay(this.firstVisible ?? openingDay(today, settings.weekStart), false);
		scroll.addEventListener('scroll', () => this.updateRangeLabel(), { passive: true });
		this.resize.observe(scroll);
		this.updateRangeLabel();
		this.attachDrag(timeline);
	}

	onunload(): void {
		this.resize.disconnect();
		super.onunload();
	}

	// ——— Scrolling ———

	private dayWidth(): number {
		const day = this.scrollEl?.querySelector<HTMLElement>('.mtm-tl-day');
		return day?.offsetWidth || DAY_WIDTH;
	}

	private labelWidth(): number {
		return this.scrollEl?.querySelector<HTMLElement>('.mtm-tl-corner')?.offsetWidth ?? 0;
	}

	private scrollToDay(day: Ymd, smooth: boolean): void {
		if (!this.scrollEl || !this.range) return;
		const index = Math.max(0, Math.min(this.range.days - 1, daysBetween(this.range.from, day)));
		this.scrollEl.scrollTo({ left: index * this.dayWidth(), behavior: smooth ? 'smooth' : 'auto' });
	}

	private visibleDays(): { first: Ymd; last: Ymd } {
		const range = this.range;
		const scroll = this.scrollEl;
		if (!range || !scroll) return { first: '', last: '' };
		const width = this.dayWidth();
		const first = Math.max(0, Math.floor(scroll.scrollLeft / width));
		const last = Math.min(range.days - 1, Math.floor((scroll.scrollLeft + scroll.clientWidth - this.labelWidth()) / width) - 1);
		return { first: addDays(range.from, first), last: addDays(range.from, Math.max(first, last)) };
	}

	private updateRangeLabel(): void {
		if (!this.rangeEl || !this.scrollEl) return;
		const { first, last } = this.visibleDays();
		if (this.dayWidth() === this.lastDayWidth) this.firstVisible = first;
		this.rangeEl.setText(rangeLabel(first, last, toYmd(new Date())));
	}

	// ——— Dragging: move a bar, or pull an end to change the start or the due date ———

	private attachDrag(timeline: HTMLElement): void {
		let drag: { bar: HTMLElement; item: ActionItem; edge: DragEdge; x: number; start: number; span: number; days: number; moved: boolean } | null = null;
		let ghost: HTMLElement | null = null;

		timeline.addEventListener('pointerdown', (e) => {
			if (e.button !== 0) return;
			const bar = (e.target as HTMLElement).closest<HTMLElement>('.mtm-tl-bar[data-path]');
			const item = bar ? this.items.find((i) => i.path === bar.dataset.path) : undefined;
			if (!bar || !item) return;
			const handle = (e.target as HTMLElement).closest('.mtm-tl-handle');
			const edge: DragEdge = handle?.hasClass('mod-start') ? 'start' : handle?.hasClass('mod-end') ? 'end' : 'move';
			const start = Number(bar.style.getPropertyValue('--mtm-start')) || 0;
			const span = Number(bar.style.getPropertyValue('--mtm-span')) || 1;
			drag = { bar, item, edge, x: e.clientX, start, span, days: 0, moved: false };
			bar.setPointerCapture(e.pointerId);
		});

		timeline.addEventListener('pointermove', (e) => {
			if (!drag) return;
			const dx = e.clientX - drag.x;
			if (!drag.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
			drag.moved = true;
			drag.days = Math.round(dx / this.dayWidth());
			let { start, span } = drag;
			if (drag.edge === 'move') start += drag.days;
			else if (drag.edge === 'start') {
				const d = Math.min(drag.days, span - 1);
				start += d;
				span -= d;
			} else span = Math.max(1, span + drag.days);
			if (!ghost) {
				ghost = drag.bar.parentElement?.createDiv({ cls: 'mtm-tl-ghost' }) ?? null;
				drag.bar.addClass('is-dragging');
			}
			ghost?.setCssProps({ '--mtm-start': String(start), '--mtm-span': String(drag.bar.hasClass('mod-milestone') ? 1 : span) });
		});

		const finish = (commit: boolean) => {
			const current = drag;
			drag = null;
			ghost?.remove();
			ghost = null;
			if (!current) return;
			current.bar.removeClass('is-dragging');
			if (!current.moved) return;
			this.suppressClick = true;
			window.setTimeout(() => (this.suppressClick = false), 0);
			if (!commit || current.days === 0) return;
			const dates = dragDates(current.item.start, current.item.due, current.edge, current.days);
			if (!dates.start && !dates.due) return;
			void this.write(current.item.path, (file) => editAction(this.plugin.app, file, this.plugin.settings, {}, dates));
		};
		timeline.addEventListener('pointerup', () => finish(true));
		timeline.addEventListener('pointercancel', () => finish(false));

		timeline.addEventListener('click', (e) => {
			const bar = (e.target as HTMLElement).closest<HTMLElement>('.mtm-tl-bar[data-path]');
			if (!bar?.dataset.path || this.suppressClick) return;
			if (Keymap.isModEvent(e)) this.open(bar.dataset.path, e);
			else this.select(bar.dataset.path);
		});
		timeline.addEventListener('dblclick', (e) => {
			const bar = (e.target as HTMLElement).closest<HTMLElement>('.mtm-tl-bar[data-path]');
			if (bar?.dataset.path) this.open(bar.dataset.path, e);
		});
	}

	private handlers: TimelineHandlers = {
		today: () => this.scrollToDay(openingDay(toYmd(new Date()), this.plugin.settings.weekStart), true),
		earlier: () => this.scrollEl?.scrollBy({ left: -7 * this.dayWidth(), behavior: 'smooth' }),
		later: () => this.scrollEl?.scrollBy({ left: 7 * this.dayWidth(), behavior: 'smooth' }),
		openMatter: (path) => void this.plugin.openMatter(path),
		toggleSection: (key) => this.toggleSphereCollapsed(key),
		select: (path) => this.select(path),
		open: (path, e) => this.open(path, e),
	};
}
