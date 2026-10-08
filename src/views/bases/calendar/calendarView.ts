// The calendar: a custom Bases view. A month of days; Bases decides which Actions appear.

import { Menu, type QueryController } from 'obsidian';
import type MattersPlugin from '../../../main';
import { toHm, toYmd, type Ymd } from '../../../model/dates';
import type { ActionItem } from '../../../services/actionItems';
import { VIEW_TYPES } from '../../../services/baseFile';
import { typeShown } from '../../../services/boardModel';
import { addMonthsTo, buildCalendar, monthOf, monthWeeks, shiftDates, type CalendarDay } from '../../../services/calendarModel';
import { isShownByDone } from '../../../model/actions';
import { editAction } from '../../../vault/actionWrites';
import { allMatters } from '../../../vault/index';
import { renderEmpty } from '../board/boardRender';
import { CollectionView } from '../collectionView';
import { renderToolbar } from '../toolbar';
import { renderCalendar, type CalendarHandlers } from './calendarRender';

const DRAG_TYPE = 'application/x-mtm-action';

export class CalendarView extends CollectionView {
	readonly type = VIEW_TYPES.calendar;
	/** The month shown (its first day). Not saved: the calendar opens on the current month. */
	private month = monthOf(toYmd(new Date()));
	private picked: Ymd | null = null;
	private days: CalendarDay[] = [];
	private items: ActionItem[] = [];

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
		const typeIds = settings.types.map((t) => t.id);
		const items = all.filter(
			(a) =>
				typeShown(a.effective.type.id, options.typesOff, typeIds) &&
				isShownByDone(a.category, a.completed, options.showDone, options.doneDays, today),
		);
		const matters = allMatters(app, settings, today);
		const grid = monthWeeks(this.month, settings.weekStart);
		const inGrid = (d: Ymd | null): d is Ymd => !!d && grid.some((w) => w.includes(d));
		// The picked day stays while it is on screen; otherwise today in the current month, else the first day.
		const picked = inGrid(this.picked) ? this.picked : monthOf(today) === this.month ? today : this.month;
		const timedToday = items.some((a) => a.category !== 'closed' && a.due?.time && a.due.date === today);

		const signature = JSON.stringify([
			this.month,
			picked,
			today,
			timedToday ? toHm(now) : '',
			settings.statuses,
			settings.types,
			settings.weekStart,
			{ ...options, typesOff: [...options.typesOff] },
			matters.map((m) => [m.path, m.name]),
			items.map((a) => [a.path, a.title, a.effective, a.priority, a.start, a.due, a.completed]),
		]);
		if (!force && signature === this.signature) return;
		this.signature = signature;
		this.items = items;

		const weeks = buildCalendar(items, grid, this.month, today);
		this.days = weeks.flat();
		const names = new Map(matters.map((m) => [m.path, m.name]));
		const previous = this.containerEl.querySelector('.mtm-scroll');
		const scrollTop = previous?.scrollTop ?? 0;

		this.containerEl.empty();
		const view = this.containerEl.createDiv({ cls: 'mtm-view' });
		const openCount = all.filter((a) => a.category !== 'closed').length;
		renderToolbar(
			view,
			{ types: settings.types, typesOff: options.typesOff, showDone: options.showDone, openCount: all.length ? openCount : null },
			{ toggleType: (id) => this.toggleType(id), toggleDone: () => this.toggleDone(), newAction: () => this.plugin.quickAdd() },
		);
		if (!all.length) {
			renderEmpty(view, { newAction: () => this.plugin.quickAdd(), newMatter: () => this.plugin.newMatter() });
			return;
		}
		const scroll = renderCalendar(
			view,
			{
				month: this.month,
				weeks,
				weekStart: settings.weekStart,
				picked,
				selected: this.plugin.selection.path,
				now,
				today,
				matterName: (path) => names.get(path) ?? path.split('/').pop()?.replace(/\.md$/i, '') ?? path,
			},
			this.handlers,
		);
		scroll.scrollTop = scrollTop;
		this.attachDrag(scroll);
	}

	private goTo(month: Ymd): void {
		this.month = month;
		this.refresh(false);
	}

	/** Drag a chip to another day: start and due move by the same number of days (times stay). */
	private attachDrag(root: HTMLElement): void {
		let drag: { path: string; from: Ymd } | null = null;
		const clear = () => root.querySelectorAll('.is-drop-target').forEach((el) => el.removeClass('is-drop-target'));
		root.addEventListener('dragstart', (e) => {
			const chip = (e.target as HTMLElement).closest<HTMLElement>('.mtm-chip[data-path]');
			const from = chip?.closest<HTMLElement>('.mtm-cal-day')?.dataset.date;
			if (!chip || !from || !chip.dataset.path) return;
			drag = { path: chip.dataset.path, from };
			e.dataTransfer?.setData(DRAG_TYPE, drag.path);
			if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
			window.setTimeout(() => chip.addClass('is-dragging'), 0);
		});
		root.addEventListener('dragover', (e) => {
			const cell = (e.target as HTMLElement).closest<HTMLElement>('.mtm-cal-day');
			if (!drag || !cell) return;
			e.preventDefault();
			if (!cell.hasClass('is-drop-target')) {
				clear();
				cell.addClass('is-drop-target');
			}
		});
		root.addEventListener('dragleave', (e) => {
			if (!root.contains(e.relatedTarget as Node | null)) clear();
		});
		root.addEventListener('drop', (e) => {
			const to = (e.target as HTMLElement).closest<HTMLElement>('.mtm-cal-day')?.dataset.date;
			const current = drag;
			clear();
			drag = null;
			if (!current || !to) return;
			e.preventDefault();
			if (to === current.from) return;
			const item = this.items.find((i) => i.path === current.path);
			if (!item) return;
			const moved = shiftDates(item.start, item.due, current.from, to);
			void this.write(current.path, (file) =>
				editAction(this.plugin.app, file, this.plugin.settings, {}, {
					...(item.start ? { start: moved.start } : {}),
					...(item.due ? { due: moved.due } : {}),
				}),
			);
		});
		root.addEventListener('dragend', () => {
			clear();
			drag = null;
			root.querySelectorAll('.is-dragging').forEach((el) => el.removeClass('is-dragging'));
		});
	}

	/** Every Action on the day; choosing one selects it. Obsidian's own menu, so the Matter shows faint. */
	private moreMenu(day: CalendarDay, anchor: HTMLElement): void {
		const names = new Map(allMatters(this.plugin.app, this.plugin.settings, toYmd(new Date())).map((m) => [m.path, m.name]));
		const menu = new Menu().setUseNativeMenu(false);
		for (const item of day.items) {
			menu.addItem((i) => {
				const time = (item.due ?? item.start)?.time;
				const title = createFragment((f) => {
					if (time) f.createEl('b', { cls: 'mtm-menu-time', text: `${time} ` });
					f.appendText(item.title);
					f.createSpan({ cls: 'mtm-menu-matter', text: names.get(item.effective.matterPath) ?? '' });
				});
				i.setTitle(title)
					.setIcon(item.effective.type.icon)
					.onClick(() => this.select(item.path));
			});
		}
		const rect = anchor.getBoundingClientRect();
		menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
	}

	private handlers: CalendarHandlers = {
		previous: () => this.goTo(addMonthsTo(this.month, -1)),
		next: () => this.goTo(addMonthsTo(this.month, 1)),
		today: () => {
			this.picked = null;
			this.goTo(monthOf(toYmd(new Date())));
		},
		add: (date) => this.plugin.quickAdd({ due: date }),
		pick: (date) => {
			if (date === this.picked) return;
			this.picked = date;
			this.refresh(false);
		},
		more: (day, anchor) => this.moreMenu(day, anchor),
		select: (path) => this.select(path),
		open: (path, e) => this.open(path, e),
		dismiss: (item) => this.dismiss(item),
	};
}

