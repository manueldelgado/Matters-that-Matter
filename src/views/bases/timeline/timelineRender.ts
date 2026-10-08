// The timeline: days across, Matters and their Actions down, a bar or diamond per Action.

import { Keymap, setIcon, setTooltip } from 'obsidian';
import { STRINGS } from '../../../strings';
import { addDays, dayLabel, daysBetween, weekday, type Ymd } from '../../../model/dates';
import type { WeekStart } from '../../../services/calendarModel';
import type { TimelineGroup, TimelineRange, TimelineRow } from '../../../services/timelineModel';
import { appendIcon, pressable, typeClasses } from '../../../ui/components/dom';
import { actionTooltip } from '../actionTooltip';

export interface TimelineInput {
	range: TimelineRange;
	groups: TimelineGroup[];
	weekStart: WeekStart;
	today: Ymd;
	selected: string | null;
	matterName: (path: string) => string;
}

export interface TimelineHandlers {
	today: () => void;
	earlier: () => void;
	later: () => void;
	openMatter: (path: string) => void;
	select: (path: string) => void;
	open: (path: string, e: MouseEvent | KeyboardEvent) => void;
}

/** "28 Sep", with the year when it is not this year's. */
export function shortDate(ymd: Ymd, today: Ymd): string {
	const [y, m = 1, d = 1] = ymd.split('-').map(Number);
	const label = `${d} ${STRINGS.dates.monthsShort[m - 1] ?? ''}`;
	return ymd.slice(0, 4) === today.slice(0, 4) ? label : `${label} ${y}`;
}

export function renderNav(view: HTMLElement, h: TimelineHandlers): HTMLElement {
	const t = STRINGS.timeline;
	const nav = view.createDiv({ cls: 'mtm-tl-nav' });
	const range = nav.createSpan({ cls: 'mtm-tl-range' });
	nav.createSpan({ cls: 'mtm-spacer' });
	nav.createEl('button', { text: t.today }).addEventListener('click', () => h.today());
	for (const [label, icon, fn] of [
		[t.earlier, 'chevron-left', h.earlier],
		[t.later, 'chevron-right', h.later],
	] as const) {
		const b = nav.createDiv({ cls: 'clickable-icon', attr: { 'aria-label': label } });
		appendIcon(b, icon);
		pressable(b, () => fn());
	}
	return range;
}

export function renderTimeline(view: HTMLElement, input: TimelineInput, h: TimelineHandlers): { scroll: HTMLElement; timeline: HTMLElement } {
	const t = STRINGS.timeline;
	const { range } = input;
	const scroll = view.createDiv({ cls: 'mtm-scroll' });
	const timeline = scroll.createDiv({ cls: 'mtm-timeline' });
	const todayIndex = daysBetween(range.from, input.today);
	timeline.setCssProps({
		'--mtm-days': String(range.days),
		'--mtm-today-index': String(todayIndex),
		// The weekend shading pattern assumes Monday first; a Sunday start shifts it by a day.
		'--mtm-weekend-shift': input.weekStart === 'sunday' ? '1' : '0',
	});

	const head = timeline.createDiv({ cls: 'mtm-tl-head' });
	head.createDiv({ cls: 'mtm-tl-corner', text: t.corner });
	for (let i = 0; i < range.days; i++) {
		const day = addDays(range.from, i);
		const weekStartDay = i % 7 === 0;
		const cell = head.createDiv({ cls: ['mtm-tl-day', ...(weekStartDay ? ['is-week-start'] : []), ...(day === input.today ? ['is-today'] : [])] });
		cell.createSpan({ cls: 'mtm-tl-week', text: weekStartDay ? shortDate(day, input.today) : '' });
		cell.appendText(t.weekdayLetters[weekday(day)] ?? '');
	}
	if (todayIndex >= 0 && todayIndex < range.days) timeline.createDiv({ cls: 'mtm-tl-today' });

	for (const group of input.groups) {
		const row = timeline.createDiv({ cls: 'mtm-tl-group' });
		const label = pressable(row.createDiv({ cls: 'mtm-tl-label' }), () => h.openMatter(group.matter.path));
		setIcon(label.createSpan({ cls: 'mtm-matter-icon' }), group.matter.icon);
		label.appendText(group.matter.name);
		row.createDiv({ cls: 'mtm-tl-track' });
		for (const r of group.rows) renderRow(timeline, r, input, h);
	}
	return { scroll, timeline };
}

function barText(r: TimelineRow, today: Ymd): string | null {
	const { item } = r;
	if (r.milestone) {
		const d = item.due ?? item.start;
		if (!d) return null;
		return d.time ? `${dayLabel(d.date, today)}${STRINGS.timeline.dateSep}${d.time}` : dayLabel(d.date, today);
	}
	if (r.span <= 2) return null;
	if (item.waitingOn) return STRINGS.timeline.waitingOn(item.waitingOn.split('/').pop() ?? item.waitingOn);
	return item.effective.status.label;
}

function renderRow(timeline: HTMLElement, r: TimelineRow, input: TimelineInput, h: TimelineHandlers): void {
	const { item } = r;
	const type = item.effective.type;
	const done = item.category === 'closed';
	const selected = item.path === input.selected;
	const flags = [...(done ? ['is-done'] : []), ...(selected ? ['is-selected'] : [])];
	const row = timeline.createDiv({ cls: ['mtm-tl-row', ...typeClasses(type), ...flags], attr: { 'data-path': item.path } });

	const label = row.createDiv({ cls: 'mtm-tl-label', text: item.title, attr: { tabindex: 0 } });
	label.addEventListener('click', (e) => {
		if (Keymap.isModEvent(e)) h.open(item.path, e);
		else h.select(item.path);
	});
	label.addEventListener('dblclick', (e) => h.open(item.path, e));
	label.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') h.open(item.path, e);
		else if (e.key === ' ') {
			e.preventDefault();
			h.select(item.path);
		}
	});

	const track = row.createDiv({ cls: 'mtm-tl-track' });
	const bar = track.createDiv({
		cls: ['mtm-tl-bar', ...typeClasses(type), ...(r.milestone ? ['mod-milestone'] : []), ...flags],
		attr: { 'data-path': item.path },
	});
	bar.setCssProps({ '--mtm-start': String(r.start), '--mtm-span': String(r.span) });
	if (!r.milestone) {
		bar.createSpan({ cls: ['mtm-tl-handle', 'mod-start'] });
		bar.createSpan({ cls: ['mtm-tl-handle', 'mod-end'] });
	}
	appendIcon(bar, type.icon);
	const text = barText(r, input.today);
	if (text) bar.createSpan({ cls: 'mtm-tl-bar-text', text });
	setTooltip(bar, actionTooltip(item, input.matterName(item.effective.matterPath), input.today));
}

/** "28 Sep – 8 Nov" for the days from `first` to `last`. */
export function rangeLabel(first: Ymd, last: Ymd, today: Ymd): string {
	return `${shortDate(first, today)}${STRINGS.timeline.rangeSep}${shortDate(last, today)}`;
}
