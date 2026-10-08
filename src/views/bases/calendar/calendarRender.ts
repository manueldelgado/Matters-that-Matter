// The calendar: a month of days with chips, bars across days, "N more", and a day list when narrow.

import { Keymap, setTooltip } from 'obsidian';
import type { TypeDef } from '../../../settings';
import { STRINGS } from '../../../strings';
import { weekday, type Ymd } from '../../../model/dates';
import type { ActionItem } from '../../../services/actionItems';
import { DAY_CHIPS, type CalendarDay, type DayEntry, type WeekStart } from '../../../services/calendarModel';
import { bindCardActions, renderCard } from '../../../ui/components/card';
import { appendIcon, typeClasses } from '../../../ui/components/dom';
import { actionTooltip } from '../actionTooltip';

export interface CalendarInput {
	month: Ymd;
	weeks: CalendarDay[][];
	weekStart: WeekStart;
	/** The day whose Actions the narrow layout lists. */
	picked: Ymd;
	selected: string | null;
	now: Date;
	today: Ymd;
	matterName: (path: string) => string;
}

export interface CalendarHandlers {
	previous: () => void;
	next: () => void;
	today: () => void;
	add: (date: Ymd) => void;
	pick: (date: Ymd) => void;
	more: (day: CalendarDay, anchor: HTMLElement) => void;
	select: (path: string) => void;
	open: (path: string, e: MouseEvent | KeyboardEvent) => void;
	dismiss: (item: ActionItem) => void;
}

function pressable(el: HTMLElement, onPress: (e: MouseEvent | KeyboardEvent) => void): HTMLElement {
	el.setAttrs({ role: 'button', tabindex: 0 });
	el.addEventListener('click', (e) => {
		e.stopPropagation();
		onPress(e);
	});
	el.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onPress(e);
		}
	});
	return el;
}

const day = (ymd: Ymd) => Number(ymd.slice(8, 10));

export function renderCalendar(view: HTMLElement, input: CalendarInput, h: CalendarHandlers): HTMLElement {
	const c = STRINGS.calendar;
	const scroll = view.createDiv({ cls: 'mtm-scroll' });
	const cal = scroll.createDiv({ cls: 'mtm-calendar' });

	const head = cal.createDiv({ cls: 'mtm-cal-head' });
	const [y, m = 1] = input.month.split('-').map(Number);
	head.createSpan({ cls: 'mtm-cal-month', text: STRINGS.dates.months[m - 1] ?? '' });
	head.createSpan({ cls: 'mtm-cal-year', text: String(y) });
	head.createSpan({ cls: 'mtm-spacer' });
	head.createEl('button', { text: c.today }).addEventListener('click', () => h.today());
	for (const [label, icon, fn] of [
		[c.previous, 'chevron-left', h.previous],
		[c.next, 'chevron-right', h.next],
	] as const) {
		const b = head.createDiv({ cls: 'clickable-icon', attr: { 'aria-label': label } });
		appendIcon(b, icon);
		pressable(b, () => fn());
	}

	const weekdays = cal.createDiv({ cls: 'mtm-cal-weekdays' });
	const first = input.weekStart === 'monday' ? 1 : 0;
	for (let i = 0; i < 7; i++) weekdays.createDiv({ cls: 'mtm-cal-weekday', text: STRINGS.dates.weekdaysShort[(first + i) % 7] ?? '' });

	const grid = cal.createDiv({ cls: 'mtm-cal-grid' });
	for (const week of input.weeks) for (const d of week) renderDay(grid, d, input, h);

	renderAgenda(cal, input, h);
	return scroll;
}

function renderDay(grid: HTMLElement, d: CalendarDay, input: CalendarInput, h: CalendarHandlers): void {
	const c = STRINGS.calendar;
	const cell = grid.createDiv({
		cls: [
			'mtm-cal-day',
			...(d.inMonth ? [] : ['is-outside']),
			...(d.isToday ? ['is-today'] : []),
			...(d.isWeekend ? ['is-weekend'] : []),
			...(d.date === input.picked ? ['is-picked'] : []),
		],
		attr: { 'data-date': d.date },
	});
	// Picking a day only matters when narrow, where it lists the day's Actions under the grid.
	cell.addEventListener('click', () => h.pick(d.date));

	const row = cell.createDiv({ cls: 'mtm-cal-date-row' });
	const add = row.createSpan({ cls: 'mtm-cal-add', attr: { 'aria-label': c.newOnDay } });
	appendIcon(add, 'plus');
	pressable(add, () => h.add(d.date));
	row.createSpan({ cls: 'mtm-cal-date', text: String(day(d.date)) });

	for (const entry of d.entries.slice(0, DAY_CHIPS)) renderEntry(cell, entry, input, h);
	const hidden = d.entries.slice(DAY_CHIPS).filter((e) => e.kind !== 'slot').length;
	if (hidden > 0) {
		const more = cell.createSpan({ cls: 'mtm-cal-more', text: c.more(hidden) });
		pressable(more, () => h.more(d, more));
	}

	const dots = cell.createDiv({ cls: 'mtm-cal-dots' });
	for (const item of d.items) {
		dots.createSpan({ cls: ['mtm-cal-dot', ...typeClasses(item.effective.type), ...(item.category === 'closed' ? ['is-done'] : [])] });
	}
}

function renderEntry(cell: HTMLElement, entry: DayEntry, input: CalendarInput, h: CalendarHandlers): void {
	if (entry.kind === 'slot') {
		cell.createDiv({ cls: 'mtm-cal-slot' });
		return;
	}
	const { item } = entry;
	const type: TypeDef = item.effective.type;
	const time = entry.kind === 'single' ? ((item.due ?? item.start)?.time ?? null) : null;
	const chip = cell.createDiv({
		cls: [
			'mtm-chip',
			...typeClasses(type),
			...(time ? ['mod-timed'] : []),
			...(entry.kind === 'span' ? [`mod-span-${entry.pos}`, ...(entry.label && entry.pos !== 'start' ? ['mod-span-week-start'] : [])] : []),
			...(item.category === 'closed' ? ['is-done'] : []),
			...(item.path === input.selected ? ['is-selected'] : []),
		],
		attr: { 'data-path': item.path, draggable: 'true', tabindex: 0 },
	});
	if (time) chip.createSpan({ cls: 'mtm-chip-time', text: time });
	else appendIcon(chip, type.icon);
	chip.createSpan({ cls: 'mtm-chip-text', text: item.title });
	setTooltip(chip, actionTooltip(item, input.matterName(item.effective.matterPath), input.today));

	chip.addEventListener('click', (e) => {
		e.stopPropagation();
		if (Keymap.isModEvent(e)) h.open(item.path, e);
		else h.select(item.path);
	});
	chip.addEventListener('dblclick', (e) => {
		e.stopPropagation();
		h.open(item.path, e);
	});
	chip.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') h.open(item.path, e);
		else if (e.key === ' ') {
			e.preventDefault();
			h.select(item.path);
		}
	});
}

/** The picked day's Actions as cards, shown only when narrow (CSS). */
function renderAgenda(cal: HTMLElement, input: CalendarInput, h: CalendarHandlers): void {
	const c = STRINGS.calendar;
	const picked = input.weeks.flat().find((d) => d.date === input.picked);
	const agenda = cal.createDiv({ cls: 'mtm-cal-agenda' });
	const [, m = 1] = input.picked.split('-').map(Number);
	const title = agenda.createDiv({
		cls: 'mtm-cal-agenda-title',
		text: `${STRINGS.dates.weekdays[weekday(input.picked)] ?? ''} ${day(input.picked)} ${STRINGS.dates.months[m - 1] ?? ''}`,
	});
	const items = picked?.items ?? [];
	title.createSpan({ cls: 'mtm-section-aside', text: c.agendaCount(items.length) });
	if (!items.length) {
		agenda.createSpan({ cls: 'mtm-field-hint', text: c.agendaEmpty });
		return;
	}
	for (const item of items) {
		const card = renderCard(agenda, item, {
			now: input.now,
			selected: item.path === input.selected,
			matterName: input.matterName(item.effective.matterPath),
			onDismiss: (i) => h.dismiss(i),
		});
		card.setAttr('draggable', 'false');
		bindCardActions(card, item.path, h);
	}
}
