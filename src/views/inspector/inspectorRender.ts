// Inspector DOM: band, orphan banner, fields, body sections and footer. No state of its own.

import { setTooltip, type TFile, type UserEvent } from 'obsidian';
import type { MattersSettings, TypeDef } from '../../settings';
import { STRINGS } from '../../strings';
import { waitAge, type Priority } from '../../model/actions';
import type { ChecklistItem } from '../../model/body';
import { fromInputs, parseMtmDate, startsAfterDue, toYmd, type MtmDate } from '../../model/dates';
import { orderLanes } from '../../model/matters';
import type { MatterInfo } from '../../services/boardModel';
import type { ActionDetails, PersonRef } from '../../vault/actionDetails';
import { appendIcon, iconEl, tileEl, typeClasses } from '../../ui/components/dom';
import { avatarEl, orphanBanner, waitAgeEl } from '../../ui/components/card';

export type DateField = 'start' | 'due';

export interface InspectorHandlers {
	close(): void;
	openNote(e: UserEvent): void;
	openMatter(path: string): void;
	openFile(file: TFile, e: UserEvent): void;
	openPerson(person: PersonRef, e: UserEvent): void;
	dismiss(): void;
	rename(title: string): void;
	setStatus(id: string): void;
	setType(id: string): void;
	setMatter(path: string): void;
	setPriority(priority: Priority | null): void;
	setDate(field: DateField, value: MtmDate | null): void;
	pickWaitingOn(): void;
	clearWaitingOn(): void;
	/** 'YYYY-MM-DD', or null to remove the date. */
	setWaitingSince(day: string | null): void;
	addPerson(): void;
	removePerson(key: string): void;
	detailsInput(text: string): void;
	detailsDone(): void;
	toggleCheck(item: ChecklistItem, checked: boolean): void;
	addCheck(text: string): void;
	delete(): void;
	markDone(): void;
	reopen(): void;
}

export interface EmptyContext {
	types: readonly TypeDef[];
	/** The sidebar holding the inspector; none when it sits in the main area. */
	side: 'left' | 'right' | null;
	phone: boolean;
	boardOpen: boolean;
	openBoard(): void;
	hideSidebar(): void;
}

/** No Action selected: a ghost stack of the user's own types, an invitation, and a way to put the sidebar away. */
export function renderEmpty(root: HTMLElement, ctx: EmptyContext): void {
	const s = STRINGS.inspector;
	const empty = root.createDiv({ cls: 'mtm-inspector' }).createDiv({ cls: 'mtm-empty mod-inspector' });

	const ghosts = ctx.types.slice(0, 3).reverse();
	if (ghosts.length) {
		const stack = empty.createDiv({ cls: 'mtm-empty-stack', attr: { 'aria-hidden': 'true' } });
		ghosts.forEach((type, i) => {
			const front = i === ghosts.length - 1;
			const card = stack.createDiv({ cls: ['mtm-card', ...typeClasses(type), ...(front ? ['is-selected'] : [])] });
			const head = card.createDiv({ cls: 'mtm-card-head' });
			tileEl(head, type.icon);
			head.createDiv({ cls: 'mtm-card-title', text: type.label });
			if (front) iconEl(head, 'mouse-pointer-click', 'mtm-empty-pointer');
		});
	}

	empty.createDiv({ cls: 'mtm-empty-title', text: s.emptyTitle });
	empty.createDiv({ cls: 'mtm-empty-text', text: s.emptyText });

	if (!ctx.boardOpen || ctx.side) {
		const actions = empty.createDiv({ cls: 'mtm-board-empty-actions' });
		if (!ctx.boardOpen) actions.createEl('button', { text: STRINGS.commands.openBoard }).addEventListener('click', () => ctx.openBoard());
		if (ctx.side) actions.createEl('button', { text: s.hideSidebar }).addEventListener('click', () => ctx.hideSidebar());
	}
	if (ctx.side) {
		const hint = empty.createDiv({ cls: 'mtm-field-hint' });
		if (ctx.phone) {
			hint.setText(s.bringBackPhone(ctx.side));
		} else {
			hint.appendText(`${s.bringBack} `);
			iconEl(hint, ctx.side === 'right' ? 'panel-right' : 'panel-left', 'mtm-kbd');
			hint.appendText(` ${s.atTop(ctx.side)}`);
		}
	}
}

/** A focusable span or div that acts as a button. */
function pressable(el: HTMLElement, onPress: (e: UserEvent) => void): HTMLElement {
	el.setAttrs({ role: 'button', tabindex: 0 });
	el.addEventListener('click', onPress);
	el.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onPress(e);
		}
	});
	return el;
}

function section(body: HTMLElement, label?: string, aside?: string): HTMLElement {
	const el = body.createDiv({ cls: 'mtm-section' });
	if (label === undefined) return el;
	const labelEl = el.createDiv({ cls: 'mtm-label', text: label });
	if (aside) labelEl.createSpan({ cls: 'mtm-label-aside', text: aside });
	return el;
}

export function renderInspector(root: HTMLElement, d: ActionDetails, settings: MattersSettings, h: InspectorHandlers): void {
	const s = STRINGS.inspector;
	const { item } = d;
	const { type, status } = item.effective;
	const inspector = root.createDiv({ cls: ['mtm-inspector', ...typeClasses(type)] });

	// Band: Matter › type, open note, close.
	const band = inspector.createDiv({ cls: 'mtm-inspector-band' });
	const crumb = pressable(band.createSpan({ cls: 'mtm-crumb' }), () => h.openMatter(item.effective.matterPath));
	iconEl(crumb, d.matter?.icon ?? 'circle-dot', 'mtm-matter-icon');
	crumb.createSpan({ cls: 'mtm-crumb-text', text: d.matter?.name ?? '' });
	iconEl(band, 'chevron-right', 'mtm-crumb-sep');
	band.createSpan({ cls: 'mtm-crumb-type', text: type.label });
	band.createSpan({ cls: 'mtm-spacer' });
	appendIcon(pressable(band.createDiv({ cls: 'clickable-icon', attr: { 'aria-label': s.openNote } }), (e) => h.openNote(e)), 'file-symlink');
	appendIcon(pressable(band.createDiv({ cls: 'clickable-icon', attr: { 'aria-label': s.close } }), () => h.close()), 'x');

	const orphan = orphanBanner(d.item.effective, () => h.dismiss());
	if (orphan) inspector.appendChild(orphan);

	const body = inspector.createDiv({ cls: 'mtm-inspector-body' });
	renderHead(body, d, h);

	const statusSeg = section(body, s.status).createDiv({ cls: 'mtm-seg mod-full' });
	for (const st of settings.statuses) {
		const b = statusSeg.createEl('button', { cls: 'mtm-seg-item', text: st.label });
		if (st.id === status.id) b.addClass('is-active');
		b.addEventListener('click', () => h.setStatus(st.id));
	}

	const picker = section(body, s.type).createDiv({ cls: 'mtm-type-picker' });
	for (const t of settings.types) {
		const b = picker.createEl('button', { cls: ['mtm-type-option', ...typeClasses(t)] });
		if (t.id === type.id) b.addClass('is-active');
		tileEl(b, t.icon, 'mod-sm');
		b.appendText(t.label);
		b.addEventListener('click', () => h.setType(t.id));
	}

	renderFields(section(body), d, h);

	renderPeople(body, d, h);

	const details = section(body, s.details).createDiv({
		cls: 'mtm-details',
		text: d.details,
		attr: { contenteditable: 'plaintext-only', 'data-placeholder': s.detailsPlaceholder, spellcheck: 'true' },
	});
	details.addEventListener('input', () => h.detailsInput(details.innerText));
	details.addEventListener('blur', () => h.detailsDone());

	renderChecklist(body, d.checklist, h);
	renderLinked(body, d, h);

	const footer = inspector.createDiv({ cls: 'mtm-inspector-footer' });
	appendIcon(pressable(footer.createDiv({ cls: 'clickable-icon', attr: { 'aria-label': s.deleteAction } }), () => h.delete()), 'trash-2');
	footer.createSpan({ cls: 'mtm-spacer' });
	if (item.category === 'closed') {
		footer.createEl('button', { text: s.reopen }).addEventListener('click', () => h.reopen());
	} else {
		const done = footer.createEl('button', { cls: 'mtm-button-done' });
		appendIcon(done, 'check');
		done.appendText(s.markDone);
		done.addEventListener('click', () => h.markDone());
	}
}

function renderHead(body: HTMLElement, d: ActionDetails, h: InspectorHandlers): void {
	const head = body.createDiv({ cls: 'mtm-inspector-head' });
	tileEl(head, d.item.effective.type.icon, 'mod-lg');
	const title = head.createDiv({
		cls: 'mtm-inspector-title',
		text: d.item.title,
		attr: { contenteditable: 'plaintext-only', 'data-placeholder': STRINGS.inspector.titlePlaceholder, spellcheck: 'true' },
	});
	let cancelled = false;
	title.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			title.blur();
		} else if (e.key === 'Escape') {
			cancelled = true;
			title.setText(d.item.title);
			title.blur();
		}
	});
	title.addEventListener('blur', () => {
		if (!cancelled) h.rename(title.innerText);
		cancelled = false;
	});
}

function renderFields(sectionEl: HTMLElement, d: ActionDetails, h: InspectorHandlers): void {
	const s = STRINGS.inspector;
	const grid = sectionEl.createDiv({ cls: 'mtm-field-grid' });

	const matterCell = grid.createDiv({ cls: 'mod-wide' });
	matterCell.createDiv({ cls: 'mtm-label', text: s.matter });
	const select = matterCell.createEl('select', { cls: 'dropdown' });
	for (const m of orderLanes(d.matters, 'top') as MatterInfo[]) {
		select.createEl('option', { value: m.path, text: m.name });
	}
	select.value = d.item.effective.matterPath;
	select.addEventListener('change', () => h.setMatter(select.value));

	const priorityCell = grid.createDiv({ cls: 'mod-wide' });
	priorityCell.createDiv({ cls: 'mtm-label', text: s.priority });
	const seg = priorityCell.createDiv({ cls: 'mtm-seg mod-full mtm-priority-picker' });
	for (const p of [1, 2, 3, null] as const) {
		const label = p === null ? s.priorities.none : s.priorities[p];
		const b = seg.createEl('button', { cls: 'mtm-seg-item', attr: { 'aria-label': label } });
		if (p === d.item.priority) b.addClass('is-active');
		if (p !== null) {
			const bars = b.createSpan({ cls: ['mtm-priority', `mod-${p}`] }).createSpan({ cls: 'mtm-priority-bars' });
			for (let i = 0; i < 3; i++) bars.createSpan({ cls: 'mtm-priority-bar' });
		}
		b.appendText(label);
		b.addEventListener('click', () => h.setPriority(p));
	}

	const invalid = startsAfterDue(d.item.start, d.item.due);
	dateCell(grid, 'start', s.start, d.item.start, invalid, h);
	const dueCell = dateCell(grid, 'due', s.due, d.item.due, invalid, h);
	if (invalid) {
		const warning = dueCell.createDiv({ cls: 'mtm-field-warning' });
		appendIcon(warning, 'triangle-alert');
		const text = warning.createSpan();
		text.createEl('b', { text: s.startAfterDue });
		text.appendText(` ${s.startAfterDueText}`);
	}
}

function dateCell(grid: HTMLElement, field: DateField, label: string, value: MtmDate | null, invalid: boolean, h: InspectorHandlers): HTMLElement {
	const s = STRINGS.inspector;
	const cell = grid.createDiv({ cls: 'mod-wide' });
	cell.createDiv({ cls: 'mtm-label', text: label });
	const box = cell.createDiv({ cls: 'mtm-datetime' });
	if (invalid) box.addClass('is-invalid');
	const date = box.createEl('input', { type: 'date', attr: { 'aria-label': label } });
	date.value = value?.date ?? '';
	let time: HTMLInputElement | null = null;
	const addTime = () => {
		time = box.createEl('input', { type: 'time', attr: { 'aria-label': s.timeOf(label) } });
		time.value = value?.time ?? '';
		time.addEventListener('change', commit);
		return time;
	};
	const commit = () => h.setDate(field, fromInputs(date.value, time?.value ?? ''));
	date.addEventListener('change', commit);
	if (value?.time) addTime();

	if (value) {
		const toggle = pressable(cell.createSpan({ cls: 'mtm-datetime-add' }), () => {
			if (value.time) {
				h.setDate(field, { date: value.date });
			} else {
				toggle.remove();
				addTime().focus();
			}
		});
		appendIcon(toggle, value.time ? 'x' : 'plus');
		toggle.appendText(value.time ? s.removeTime : s.addTime);
	}
	return cell;
}

function personChip(parent: HTMLElement, person: PersonRef, waiting: boolean, h: InspectorHandlers, onRemove: () => void): void {
	const chip = parent.createSpan({ cls: waiting ? 'mtm-link-chip mod-waiting' : 'mtm-link-chip' });
	avatarEl(chip, person.name);
	const link = chip.createEl('a', { cls: 'internal-link', text: person.name, href: person.linktext, attr: { 'data-href': person.linktext } });
	link.addEventListener('click', (e) => {
		e.preventDefault();
		h.openPerson(person, e);
	});
	const remove = chip.createEl('button', { cls: 'mtm-chip-remove', attr: { 'aria-label': STRINGS.inspector.remove(person.name) } });
	appendIcon(remove, 'x');
	remove.addEventListener('click', onRemove);
}

function chipAdd(parent: HTMLElement, icon: string, label: string, onPress: () => void): void {
	const add = pressable(parent.createSpan({ cls: 'mtm-chip-add' }), onPress);
	appendIcon(add, icon);
	add.appendText(label);
}

function renderPeople(body: HTMLElement, d: ActionDetails, h: InspectorHandlers): void {
	const s = STRINGS.inspector;
	const waitingSection = section(body, s.waitingOn);
	const waiting = waitingSection.createDiv({ cls: 'mtm-link-chips' });
	if (d.waitingOn) personChip(waiting, d.waitingOn, true, h, () => h.clearWaitingOn());
	chipAdd(waiting, 'plus', d.waitingOn ? s.change : s.someone, () => h.pickWaitingOn());
	if (d.waitingOn) renderWaitingSince(waitingSection, d.waitingSince, h);

	const people = section(body, s.people).createDiv({ cls: 'mtm-link-chips' });
	for (const person of d.people) personChip(people, person, false, h, () => h.removePerson(person.key));
	chipAdd(people, 'user-plus', s.addPerson, () => h.addPerson());
}

/** "Since" and an editable date, for a wait that started before it was recorded; the age follows. */
function renderWaitingSince(parent: HTMLElement, since: string | null, h: InspectorHandlers): void {
	const s = STRINGS.inspector;
	const row = parent.createDiv({ cls: 'mtm-waiting-since' });
	appendIcon(row, 'clock');
	row.createSpan({ text: s.waitingSince });
	const input = row.createEl('input', { type: 'date', attr: { 'aria-label': s.waitingSinceLabel } });
	input.value = since ?? '';
	input.addEventListener('change', () => {
		const day = parseMtmDate(input.value);
		if (input.value === '') h.setWaitingSince(null);
		else if (day && !day.time) h.setWaitingSince(day.date);
	});
	if (since) waitAgeEl(row, waitAge(since, toYmd(new Date())), false);
}

function renderChecklist(body: HTMLElement, items: ChecklistItem[], h: InspectorHandlers): void {
	const s = STRINGS.inspector;
	const done = items.filter((i) => i.checked).length;
	const list = section(body, s.checklist, items.length ? s.checklistCount(done, items.length) : undefined).createDiv({ cls: 'mtm-checklist' });
	for (const item of items) {
		const row = list.createEl('label', { cls: item.checked ? 'mtm-check-item is-checked' : 'mtm-check-item' });
		const box = row.createEl('input', { type: 'checkbox' });
		box.checked = item.checked;
		box.addEventListener('change', () => h.toggleCheck(item, box.checked));
		row.createSpan({ cls: 'mtm-check-text', text: item.text });
	}
	const add = list.createDiv({ cls: 'mtm-check-add' });
	appendIcon(add, 'plus');
	const input = add.createEl('input', { type: 'text', attr: { placeholder: s.addStep, 'aria-label': s.addStep } });
	input.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && !e.isComposing && input.value.trim()) {
			e.preventDefault();
			h.addCheck(input.value);
			input.value = '';
		}
	});
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(ext: string): string {
	if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(ext)) return 'image';
	if (['mp3', 'wav', 'm4a', 'ogg', 'flac', 'webm'].includes(ext)) return 'file-audio';
	if (['mp4', 'mov', 'mkv', 'ogv'].includes(ext)) return 'file-video';
	if (ext === 'pdf') return 'file-text';
	return 'paperclip';
}

function renderLinked(body: HTMLElement, d: ActionDetails, h: InspectorHandlers): void {
	const s = STRINGS.inspector;
	const notes = section(body, s.linkedNotes);
	if (!d.linkedNotes.length) {
		notes.createDiv({ cls: 'mtm-field-hint', text: s.noLinkedNotes });
	} else {
		const stack = notes.createDiv({ cls: 'mtm-stack' });
		for (const file of d.linkedNotes) {
			const row = pressable(stack.createDiv({ cls: 'mtm-linked-note' }), (e) => h.openFile(file, e));
			appendIcon(row, 'file-text');
			const text = row.createSpan({ cls: 'mtm-linked-note-text' });
			text.createSpan({ cls: 'mtm-linked-note-title', text: file.basename });
			const parent = file.parent?.path;
			if (parent && parent !== '/') text.createSpan({ cls: 'mtm-linked-note-path', text: parent });
		}
	}

	if (!d.attachments.length) return;
	const stack = section(body, s.attachments).createDiv({ cls: 'mtm-stack' });
	for (const file of d.attachments) {
		const row = pressable(stack.createDiv({ cls: 'mtm-attachment' }), (e) => h.openFile(file, e));
		setTooltip(row, file.path);
		appendIcon(row, fileIcon(file.extension.toLowerCase()));
		row.createSpan({ cls: 'mtm-attachment-name', text: file.name });
		row.createSpan({ cls: 'mtm-attachment-meta', text: `${file.extension.toUpperCase()} · ${formatSize(file.stat.size)}` });
	}
}
