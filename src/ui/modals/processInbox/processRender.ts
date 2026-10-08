// Process Inbox: the pieces of the modal. DOM only; the modal keeps the state and makes the writes.

import type { StatusDef, TypeDef } from '../../../settings';
import { STRINGS } from '../../../strings';
import { decisionIcon, type Decision, type TallyLine } from '../../../services/processInbox';
import { appendIcon, statusClasses, tileEl, typeClasses } from '../../components/dom';

export function kbd(parent: HTMLElement, key: string): HTMLElement {
	return parent.createSpan({ cls: 'mtm-kbd', text: key });
}

/** Eyebrow, slim progress bar and "3 of 7". */
export function renderBar(parent: HTMLElement, position: number, total: number, processed: number): void {
	const bar = parent.createDiv({ cls: 'mtm-process-bar' });
	const eyebrow = bar.createSpan({ cls: 'mtm-eyebrow' });
	appendIcon(eyebrow, 'inbox');
	eyebrow.appendText(STRINGS.process.title);
	const progress = bar.createDiv({ cls: 'mtm-progress' });
	progress.setCssProps({ '--mtm-progress': `${total ? Math.round((processed / total) * 100) : 100}%` });
	progress.createDiv({ cls: 'mtm-progress-fill' });
	bar.createSpan({ cls: 'mtm-process-count', text: STRINGS.process.count(Math.min(position, total), total) });
}

/** The question and the seven answers in two groups, numbered for the keyboard. */
export function renderDecisions(parent: HTMLElement, onChoose: (d: Decision) => void): void {
	const p = STRINGS.process;
	parent.createDiv({ cls: 'mtm-process-question', text: p.question });
	const grid = parent.createDiv({ cls: 'mtm-decisions' });
	let key = 1;
	for (const [label, group] of [
		[p.no, ['trash', 'note', 'someday']],
		[p.yes, ['done', 'delegate', 'next', 'matter']],
	] as const) {
		const col = grid.createDiv({ cls: 'mtm-decision-group' });
		col.createDiv({ cls: 'mtm-label', text: label });
		for (const d of group) {
			const [name, sub] = p.decisions[d];
			const button = col.createEl('button', { cls: ['mtm-decision', ...(d === 'done' ? ['mod-done'] : d === 'trash' ? ['mod-trash'] : [])] });
			tileEl(button, decisionIcon(d), d === 'done' ? undefined : 'mod-neutral');
			const text = button.createSpan({ cls: 'mtm-decision-text' });
			text.createSpan({ cls: 'mtm-decision-label', text: name });
			text.createSpan({ cls: 'mtm-decision-sub', text: sub });
			kbd(button, String(key++));
			button.addEventListener('click', () => onChoose(d));
		}
	}
}

/** The head of a step: back to the question, the decision's tile and name, an optional hint. */
export function renderStepHead(parent: HTMLElement, d: Decision, hint: string | null, onBack: () => void): void {
	const head = parent.createDiv({ cls: 'mtm-process-step-head' });
	const back = head.createDiv({ cls: 'clickable-icon', attr: { 'aria-label': STRINGS.process.backToQuestion } });
	appendIcon(back, 'arrow-left');
	back.addEventListener('click', onBack);
	tileEl(head, decisionIcon(d), 'mod-neutral');
	head.createSpan({ cls: 'mtm-process-step-title', text: STRINGS.process.decisions[d][0] });
	if (hint) head.createSpan({ cls: 'mtm-field-hint', text: hint });
}

export function field(parent: HTMLElement, label: string, aside?: string): HTMLElement {
	const el = parent.createDiv({ cls: 'mtm-field' });
	const labelEl = el.createDiv({ cls: 'mtm-label', text: label });
	if (aside) labelEl.createSpan({ cls: 'mtm-label-aside', text: aside });
	return el;
}

/** A text input with a leading icon. */
export function iconInput(parent: HTMLElement, icon: string, value: string, label: string, placeholder?: string): HTMLInputElement {
	const wrap = parent.createDiv({ cls: 'mtm-input-icon' });
	appendIcon(wrap, icon);
	const input = wrap.createEl('input', { type: 'text', value, attr: { 'aria-label': label, ...(placeholder ? { placeholder } : {}) } });
	return input;
}

/** One segment per status, with its dot. */
export function statusSegments(parent: HTMLElement, statuses: readonly StatusDef[], active: string | null, onPick: (id: string) => void): void {
	const seg = parent.createDiv({ cls: 'mtm-seg mod-full' });
	for (const status of statuses) {
		const b = seg.createEl('button', { cls: ['mtm-seg-item', ...statusClasses(status), ...(status.id === active ? ['is-active'] : [])] });
		b.createSpan({ cls: 'mtm-status-dot' });
		b.appendText(status.label);
		b.addEventListener('click', () => {
			seg.querySelectorAll('.is-active').forEach((el) => el.removeClass('is-active'));
			b.addClass('is-active');
			onPick(status.id);
		});
	}
}

/** A date in plain words, with the parsed date as a chip beside it. */
export function dateField(parent: HTMLElement, label: string, text: string, chip: (text: string) => string | null, onInput: (text: string) => void): HTMLInputElement {
	const el = field(parent, label);
	const row = el.createDiv({ cls: 'mtm-process-date' });
	const input = iconInput(row, 'calendar', text, label, STRINGS.process.datePlaceholder);
	const chipEl = row.createSpan({ cls: 'mtm-token mod-date' });
	const update = () => {
		const parsed = input.value.trim() ? chip(input.value) : null;
		chipEl.empty();
		chipEl.toggle(!!parsed);
		if (parsed) {
			appendIcon(chipEl, 'calendar');
			chipEl.appendText(parsed);
		}
	};
	input.addEventListener('input', () => {
		onInput(input.value);
		update();
	});
	update();
	return input;
}

/** A destination choice (Someday): radio, tile, label and meta. */
export function destination(parent: HTMLElement, active: boolean, icon: string, label: string, meta: HTMLElement | string, onPick: () => void): void {
	const el = parent.createDiv({ cls: ['mtm-destination', ...(active ? ['is-active'] : [])], attr: { role: 'radio', 'aria-checked': String(active), tabindex: 0 } });
	el.createSpan({ cls: 'mtm-destination-radio' });
	tileEl(el, icon, 'mod-neutral');
	el.appendText(label);
	const metaEl = el.createSpan({ cls: 'mtm-destination-meta' });
	if (typeof meta === 'string') metaEl.setText(meta);
	else metaEl.appendChild(meta);
	el.addEventListener('click', onPick);
	el.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onPick();
		}
	});
}

/** Footer hints on the left: keys and what they do. */
export function hints(parent: HTMLElement, items: readonly [string, string][]): void {
	const el = parent.createSpan({ cls: 'mtm-process-hints' });
	for (const [key, label] of items) {
		const hint = el.createSpan();
		kbd(hint, key);
		hint.appendText(label);
	}
}

export interface FiledCard {
	type: TypeDef;
	title: string;
}

/** The end: a filed stack of the last items, a serif title, what went where, and the way on. */
export function renderEnd(
	parent: HTMLElement,
	input: { filed: readonly FiledCard[]; tally: readonly TallyLine[]; left: number; empty: boolean },
	h: { openBoard(): void; close(): void },
): void {
	const p = STRINGS.process;
	const end = parent.createDiv({ cls: 'mtm-process-zero' });
	if (input.filed.length) {
		const stack = end.createDiv({ cls: 'mtm-empty-stack', attr: { 'aria-hidden': 'true' } });
		for (const card of input.filed.slice(-3)) {
			const el = stack.createDiv({ cls: ['mtm-card', ...typeClasses(card.type)] });
			const head = el.createDiv({ cls: 'mtm-card-head' });
			tileEl(head, card.type.icon);
			head.createDiv({ cls: 'mtm-card-title', text: card.title });
			appendIcon(head.createSpan({ cls: 'mtm-card-check' }), 'circle-check');
		}
	}
	end.createEl('h2', { cls: 'mtm-process-zero-title', text: input.left ? p.leftTitle(input.left) : p.zeroTitle });
	end.createEl('p', { cls: 'mtm-process-zero-text', text: input.left ? p.leftText : input.empty ? p.emptyText : p.zeroText });
	if (input.tally.length) {
		const tally = end.createDiv({ cls: 'mtm-process-tally' });
		const t = p.tally;
		for (const line of input.tally) {
			const token = tally.createSpan({ cls: 'mtm-token' });
			appendIcon(token, line.icon);
			const n = line.count;
			token.appendText(
				line.decision === 'next'
					? t.next(n, line.detail ?? '')
					: line.decision === 'delegate'
						? t.delegate(n, line.detail)
						: t[line.decision](n),
			);
		}
	}
	const actions = end.createDiv({ cls: 'mtm-board-empty-actions' });
	const board = actions.createEl('button', { cls: input.left ? undefined : 'mod-cta', text: p.openBoard });
	board.addEventListener('click', () => h.openBoard());
	const close = actions.createEl('button', { cls: input.left ? 'mod-cta' : undefined, text: p.close });
	close.addEventListener('click', () => h.close());
	end.createSpan({ cls: 'mtm-field-hint', text: p.zeroHint });
}
