// Matter overview: header (eyebrow, title, about, controls, stats) and Actions by status.

import { setIcon, setTooltip, type TFile } from 'obsidian';
import type { MattersSettings } from '../../settings';
import { backlogStatus } from '../../model/workflow';
import { STRINGS } from '../../strings';
import { dayLabel, toYmd, type Ymd } from '../../model/dates';
import { parseCadence, type Cadence, type MatterState } from '../../model/matters';
import type { ActionItem } from '../../services/actionItems';
import type { MatterInfo } from '../../services/boardModel';
import { reviewState, type OverviewModel } from '../../services/overviewModel';
import { avatarEl, bindCardActions, renderCard } from '../../ui/components/card';
import { cadenceFields } from '../../ui/components/cadenceFields';
import { appendIcon, pressable, statusClasses, tileEl } from '../../ui/components/dom';

export interface OverviewData {
	matter: MatterInfo;
	file: TFile;
	rawCadence: unknown;
	/** Null for the Inbox, which has no about section. */
	body: string | null;
	model: OverviewModel;
	people: TFile[];
	notes: TFile[];
	settings: MattersSettings;
	now: Date;
	today: Ymd;
	selected: string | null;
	showAllDone: boolean;
	/** The cadence dropdown shows Custom (chosen, not yet committed). */
	customCadence: boolean;
	/** An active Matter with nothing in motion. */
	noNextAction: boolean;
}

export interface OverviewHandlers {
	changeIcon: () => void;
	/** Opens the Sphere menu under the chip. */
	changeSphere: (anchor: HTMLElement) => void;
	showOnBoard: () => void;
	newAction: () => void;
	/** Quick add in this Matter, starting in the next-step status. */
	newNextAction: () => void;
	processInbox: () => void;
	openNote: (e: MouseEvent | KeyboardEvent) => void;
	renderAbout: (el: HTMLElement, markdown: string) => void;
	setState: (state: MatterState) => void;
	markReviewed: () => void;
	setCadence: (cadence: Cadence | null) => void;
	/** The edited outcome; blank removes it. */
	setOutcome: (text: string) => void;
	chooseCustom: () => void;
	select: (path: string) => void;
	open: (path: string, e: MouseEvent | KeyboardEvent) => void;
	dismiss: (item: ActionItem) => void;
	toggleDone: () => void;
	openFile: (file: TFile, e: MouseEvent | KeyboardEvent) => void;
}

const STATE_ICONS: Record<MatterState, string> = { active: 'circle-play', dormant: 'moon', closed: 'archive' };

/** "14 September", with the year when it is not this year. */
function longDate(ymd: Ymd, today: Ymd): string {
	const [y, m = 1, d = 1] = ymd.split('-').map(Number);
	const label = `${d} ${STRINGS.dates.months[m - 1] ?? ''}`;
	return ymd.slice(0, 4) === today.slice(0, 4) ? label : `${label} ${y}`;
}

export function renderOverview(parent: HTMLElement, d: OverviewData, h: OverviewHandlers): void {
	const view = parent.createDiv({ cls: 'mtm-view' });
	const scroll = view.createDiv({ cls: 'mtm-scroll' });
	const inner = scroll.createDiv({ cls: 'mtm-overview' }).createDiv({ cls: 'mtm-overview-inner' });
	const header = inner.createDiv({ cls: 'mtm-overview-header' });
	renderHeader(header, d, h);

	if (d.model.stats.total === 0) {
		renderEmpty(inner, h);
		if (d.notes.length) renderAside(inner.createDiv({ cls: 'mtm-overview-col' }), d, h);
		return;
	}
	renderStats(header, d);
	const columns = inner.createDiv({ cls: 'mtm-overview-columns' });
	renderSections(columns.createDiv({ cls: 'mtm-overview-col' }), d, h);
	renderAside(columns.createDiv({ cls: 'mtm-overview-col' }), d, h);
}

function renderHeader(header: HTMLElement, d: OverviewData, h: OverviewHandlers): void {
	const o = STRINGS.overview;
	const { matter } = d;
	const eyebrow = header.createDiv({ cls: 'mtm-eyebrow' });
	if (matter.isInbox) {
		eyebrow.createSpan({ text: matter.name });
		eyebrow.createSpan({ text: '·' });
		eyebrow.createSpan({ text: o.inboxEyebrow });
	} else {
		const spheres = d.settings.spheres;
		if (spheres.length) {
			const sphere = spheres.find((x) => x.id === matter.sphere);
			const chip = eyebrow.createSpan({ cls: ['mtm-sphere-chip', ...(sphere ? [] : ['mod-none'])] });
			appendIcon(chip, sphere?.icon ?? 'circle-dashed');
			chip.appendText(sphere?.label ?? STRINGS.spheres.none);
			appendIcon(chip, 'chevron-down');
			setTooltip(chip, STRINGS.spheres.change);
			pressable(chip, () => h.changeSphere(chip));
		}
		eyebrow.createSpan({ text: o.matter });
		eyebrow.createSpan({ text: '·' });
		eyebrow.createSpan({ text: o.since(longDate(toYmd(new Date(d.file.stat.ctime)), d.today)) });
		const pill = eyebrow.createSpan({ cls: ['mtm-state-pill', `mod-${matter.state}`] });
		appendIcon(pill, STATE_ICONS[matter.state]);
		pill.appendText(o.states[matter.state]);
	}

	const row = header.createDiv({ cls: 'mtm-overview-title-row' });
	const tile = pressable(tileEl(row, matter.icon, 'mod-xl mod-neutral'), () => h.changeIcon());
	setTooltip(tile, o.changeIcon);
	row.createEl('h1', { cls: 'mtm-overview-title', text: matter.name });
	row.createEl('button', { text: o.showOnBoard }).addEventListener('click', () => h.showOnBoard());
	// The Inbox's primary button processes it while it has open Actions.
	const processing = matter.isInbox && d.model.stats.open > 0;
	row.createEl('button', { cls: processing ? undefined : 'mod-cta', text: o.newAction }).addEventListener('click', () => h.newAction());
	if (processing) row.createEl('button', { cls: 'mod-cta', text: STRINGS.process.title }).addEventListener('click', () => h.processInbox());

	if (!matter.isInbox) renderOutcome(header, matter.outcome, h);

	if (d.body !== null) {
		const about = header.createDiv();
		const text = d.body.trim();
		if (text) h.renderAbout(about.createDiv({ cls: ['mtm-overview-about', 'markdown-rendered'] }), text);
		else about.createDiv({ cls: ['mtm-overview-about', 'mod-empty'], text: o.aboutEmpty });
		const open = pressable(about.createSpan({ cls: 'mtm-overview-about-open' }), (e) => h.openNote(e));
		appendIcon(open, 'file-symlink');
		open.appendText(o.openNote);
	}

	if (!matter.isInbox) renderControls(header, d, h);
}

/** The outcome under the title, edited in place (Enter or blur saves, Esc cancels); a dashed invitation when unset. */
function renderOutcome(header: HTMLElement, outcome: string | null, h: OverviewHandlers): void {
	const o = STRINGS.overview;
	const box = header.createDiv({ cls: ['mtm-outcome', ...(outcome ? [] : ['mod-empty'])] });
	appendIcon(box, 'flag');
	box.createSpan({ cls: 'mtm-outcome-label', text: o.outcome });
	const text = box.createSpan({
		cls: 'mtm-outcome-text',
		text: outcome ?? o.outcomeEmpty,
		attr: { contenteditable: 'plaintext-only', spellcheck: 'true', role: 'textbox' },
	});
	let cancelled = false;
	text.addEventListener('focus', () => {
		if (outcome) return;
		// The invitation gives way to an empty line.
		text.setText('');
		box.removeClass('mod-empty');
	});
	text.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			text.blur();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelled = true;
			text.blur();
		}
	});
	text.addEventListener('blur', () => {
		const value = text.innerText.replace(/\s+/g, ' ').trim();
		if (cancelled || value === (outcome ?? '')) {
			cancelled = false;
			text.setText(outcome ?? o.outcomeEmpty);
			box.toggleClass('mod-empty', !outcome);
			return;
		}
		h.setOutcome(value);
	});
	if (outcome) {
		const edit = box.createDiv({ cls: 'clickable-icon', attr: { 'aria-label': o.editOutcome } });
		appendIcon(edit, 'pencil');
		pressable(edit, () => text.focus());
	}
}

function renderControls(header: HTMLElement, d: OverviewData, h: OverviewHandlers): void {
	const o = STRINGS.overview;
	const { matter } = d;
	const controls = header.createDiv({ cls: 'mtm-overview-controls' });

	const seg = controls.createDiv({ cls: 'mtm-seg', attr: { role: 'radiogroup' } });
	for (const state of ['active', 'dormant', 'closed'] as const) {
		const active = matter.state === state;
		const b = seg.createEl('button', {
			cls: ['mtm-seg-item', ...(active ? ['is-active'] : [])],
			attr: { role: 'radio', 'aria-checked': String(active) },
		});
		appendIcon(b, STATE_ICONS[state]);
		b.appendText(o.states[state]);
		b.addEventListener('click', () => {
			if (!active) h.setState(state);
		});
	}

	const review = matter.review;
	if (review?.cadence) {
		const { state, daysLate } = reviewState(review, d.today);
		const el = controls.createSpan({ cls: ['mtm-review', `is-${state}`] });
		appendIcon(el, state === 'ontime' ? 'circle-check' : state === 'overdue' ? 'alarm-clock' : 'circle-dashed');
		el.appendText(state === 'ontime' ? o.reviewedAgo(review.daysSince ?? 0) : state === 'overdue' ? o.reviewLate(daysLate) : o.notReviewed);
		const button = controls.createEl('button', { cls: 'mtm-review-button' });
		appendIcon(button, 'check');
		button.appendText(o.markReviewed);
		button.addEventListener('click', () => h.markReviewed());
	}

	renderCadence(controls, d, h);
}

/** The cadence dropdown (K1): Never, the presets, Custom with "Every <n> <unit>". */
function renderCadence(controls: HTMLElement, d: OverviewData, h: OverviewHandlers): void {
	const o = STRINGS.overview;
	const c = STRINGS.cadence;
	const raw = typeof d.rawCadence === 'string' ? d.rawCadence.trim() : '';
	const cadence = parseCadence(d.rawCadence);
	const preset = cadence ? c.presets.find(([key]) => key === `${cadence.n}${cadence.unit}`)?.[0] : undefined;
	const value = d.customCadence || (cadence && !preset) ? 'custom' : (preset ?? 'never');

	const wrap = controls.createSpan({ cls: 'mtm-overview-cadence' });
	wrap.appendText(o.review);
	const select = wrap.createEl('select', { cls: 'dropdown', attr: { 'aria-label': o.review } });
	select.createEl('option', { value: 'never', text: c.never });
	for (const [key, label] of c.presets) select.createEl('option', { value: key, text: label });
	select.createEl('option', { value: 'custom', text: c.custom });
	select.value = value;
	select.addEventListener('change', () => {
		if (select.value === 'custom') h.chooseCustom();
		else h.setCadence(select.value === 'never' ? null : parseCadence(select.value));
	});

	if (value === 'custom') {
		const fields = cadenceFields(controls, cadence ?? { n: 1, unit: 'w' }, (next) => {
			if (next) h.setCadence(next);
		});
		if (d.customCadence && !cadence) fields.focus();
	}
	if (raw && !cadence) controls.createSpan({ cls: 'mtm-field-hint', text: o.invalidCadence(raw) });
}

function renderStats(header: HTMLElement, d: OverviewData): void {
	const o = STRINGS.overview.stats;
	const { stats } = d.model;
	const row = header.createDiv({ cls: 'mtm-stats' });
	const stat = (mod: string | null, value: string, label: string) => {
		const el = row.createDiv({ cls: ['mtm-stat', ...(mod ? [mod] : [])] });
		el.createSpan({ cls: 'mtm-stat-value', text: value });
		el.createSpan({ cls: 'mtm-stat-label', text: label });
		return el;
	};
	stat(null, String(stats.open), o.open);
	stat('mod-today', String(stats.today), o.today);
	stat('mod-waiting', String(stats.waiting), o.waiting);

	const review = d.matter.review;
	if (review?.cadence) {
		const { state, daysLate } = reviewState(review, d.today);
		// Due today reads "Today"; later than that, "Overdue".
		const value = state === 'never' ? o.now : state === 'overdue' && daysLate > 0 ? o.overdue : dayLabel(review.nextDue ?? d.today, d.today);
		const el = stat('mod-review', value, o.nextReview);
		if (state !== 'ontime') el.addClass('is-overdue');
	}

	const pct = stats.total ? Math.round((stats.closed / stats.total) * 100) : 0;
	const progress = row.createDiv({ cls: ['mtm-stat', 'mod-grow'] });
	const label = progress.createSpan({ cls: 'mtm-stat-label' });
	label.createSpan({ text: o.done(stats.closed, stats.total) });
	label.createSpan({ text: `${pct}%` });
	const bar = progress.createDiv({ cls: 'mtm-progress' });
	bar.setCssProps({ '--mtm-progress': `${pct}%` });
	bar.createDiv({ cls: 'mtm-progress-fill' });
}

/** A calm notice above the Actions when nothing is in motion, with its two ways out. */
function renderNoNextAction(col: HTMLElement, d: OverviewData, h: OverviewHandlers): void {
	const s = STRINGS.nextAction;
	const notice = col.createDiv({ cls: ['mtm-notice', 'mod-stalled'] });
	appendIcon(notice, 'signpost');
	const text = notice.createDiv();
	text.createEl('b', { text: s.noticeTitle });
	const backlog = backlogStatus(d.settings.statuses);
	text.appendText(` ${backlog ? s.notice(backlog.label) : s.noticeNoBacklog}`);
	const actions = text.createDiv({ cls: 'mtm-notice-actions' });
	actions.createEl('button', { cls: 'mod-cta', text: STRINGS.overview.newAction }).addEventListener('click', () => h.newNextAction());
	const dormant = actions.createEl('button');
	appendIcon(dormant, 'moon');
	dormant.appendText(s.markDormant);
	dormant.addEventListener('click', () => h.setState('dormant'));
}

function renderSections(col: HTMLElement, d: OverviewData, h: OverviewHandlers): void {
	const o = STRINGS.overview;
	if (d.noNextAction) renderNoNextAction(col, d, h);
	for (const section of d.model.sections) {
		const block = col.createDiv();
		const title = block.createDiv({ cls: 'mtm-section-title' });
		const chip = title.createSpan({ cls: ['mtm-status', ...statusClasses(section.status)] });
		chip.createSpan({ cls: 'mtm-status-dot' });
		chip.appendText(section.status.label);
		const closed = section.status.category === 'closed';
		title.createSpan({ cls: 'mtm-section-aside', text: closed && !d.showAllDone ? o.doneWindow : String(section.items.length) });

		if (section.items.length) {
			const stack = block.createDiv({ cls: 'mtm-stack' });
			for (const item of section.items) renderOverviewCard(stack, item, d, h);
		}
		if (closed && (section.hidden > 0 || d.showAllDone)) {
			const total = section.items.length + section.hidden;
			const more = pressable(block.createSpan({ cls: 'mtm-section-more' }), () => h.toggleDone());
			more.setText(d.showAllDone ? o.showRecentDone : o.showAllDone(total));
		}
	}
}

function renderOverviewCard(stack: HTMLElement, item: ActionItem, d: OverviewData, h: OverviewHandlers): void {
	const card = renderCard(stack, item, { now: d.now, selected: item.path === d.selected, onDismiss: (i) => h.dismiss(i) });
	card.setAttr('draggable', 'false');
	bindCardActions(card, item.path, h);
}

function renderAside(col: HTMLElement, d: OverviewData, h: OverviewHandlers): void {
	const o = STRINGS.overview;
	if (d.people.length) {
		const block = col.createDiv();
		const title = block.createDiv({ cls: 'mtm-section-title', text: o.people });
		title.createSpan({ cls: 'mtm-section-aside', text: o.peopleAside });
		const chips = block.createDiv({ cls: 'mtm-link-chips' });
		for (const person of d.people) {
			const chip = chips.createSpan({ cls: 'mtm-link-chip' });
			avatarEl(chip, person.basename, 'mod-sm');
			const link = chip.createEl('a', { cls: 'internal-link', text: person.basename, href: '#' });
			chip.appendText(' ');
			link.addEventListener('click', (e) => {
				e.preventDefault();
				h.openFile(person, e);
			});
		}
	}
	if (d.notes.length) {
		const block = col.createDiv();
		const title = block.createDiv({ cls: 'mtm-section-title', text: o.notes });
		title.createSpan({ cls: 'mtm-section-aside', text: o.notesAside });
		const stack = block.createDiv({ cls: 'mtm-stack' });
		for (const note of d.notes) {
			const row = pressable(stack.createDiv({ cls: 'mtm-linked-note' }), (e) => h.openFile(note, e));
			appendIcon(row, 'file-text');
			const text = row.createSpan({ cls: 'mtm-linked-note-text' });
			text.createSpan({ cls: 'mtm-linked-note-title', text: note.basename });
			const folder = note.parent?.path;
			if (folder && folder !== '/') text.createSpan({ cls: 'mtm-linked-note-path', text: folder });
			appendIcon(row, 'chevron-right');
		}
	}
}

function renderEmpty(inner: HTMLElement, h: OverviewHandlers): void {
	const o = STRINGS.overview;
	const empty = inner.createDiv({ cls: ['mtm-empty', 'mod-overview'] });
	empty.createSpan({ cls: 'mtm-empty-title', text: o.emptyTitle });
	empty.appendText(o.emptyText);
	const actions = empty.createDiv({ cls: 'mtm-board-empty-actions' });
	actions.createEl('button', { cls: 'mod-cta', text: o.newAction }).addEventListener('click', () => h.newAction());
}

/** Shown when the Matter's note is gone. */
export function renderMissing(parent: HTMLElement): void {
	const empty = parent.createDiv({ cls: 'mtm-view' }).createDiv({ cls: ['mtm-empty', 'mod-overview'] });
	setIcon(empty.createSpan(), 'folder-x');
	empty.appendText(STRINGS.overview.missing);
}
