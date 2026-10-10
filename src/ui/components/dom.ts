// Small DOM helpers shared by views and modals.

import { setIcon, setTooltip } from 'obsidian';
import type { StatusDef, TypeDef } from '../../settings';
import { classId } from '../../services/ids';
import { STRINGS } from '../../strings';

/** A span holding a Lucide icon. */
export function iconEl(parent: HTMLElement, name: string, cls?: string): HTMLElement {
	const el = parent.createSpan(cls ? { cls } : undefined);
	setIcon(el, name);
	return el;
}

/** Appends a Lucide icon directly (for buttons and rows whose CSS targets `> .svg-icon`). */
export function appendIcon(parent: HTMLElement, name: string): void {
	const holder = createSpan();
	setIcon(holder, name);
	const svg = holder.firstElementChild;
	if (svg) parent.appendChild(svg);
}

export function typeClasses(type: Pick<TypeDef, 'id' | 'tone'>): string[] {
	return [`mtm-type-${classId(type.id)}`, `mtm-tone-${type.tone}`];
}

export function statusClasses(status: Pick<StatusDef, 'id' | 'tone'>): string[] {
	return [`mtm-status-${classId(status.id)}`, `mtm-status-tone-${status.tone}`];
}

/** Replaces classes that start with any of the prefixes, except those in `keep`. */
export function swapClasses(el: HTMLElement, prefixes: readonly string[], next: readonly string[], keep: readonly string[] = []): void {
	for (const cls of Array.from(el.classList)) {
		if (!keep.includes(cls) && prefixes.some((p) => cls.startsWith(p))) el.removeClass(cls);
	}
	el.addClasses([...next]);
}

/** A tile with an icon: `.mtm-tile`. */
export function tileEl(parent: HTMLElement, icon: string, mod?: string): HTMLElement {
	const el = parent.createSpan({ cls: mod ? `mtm-tile ${mod}` : 'mtm-tile' });
	setIcon(el, icon);
	return el;
}

/** A status chip with its dot: `.mtm-status`. */
export function statusChip(parent: HTMLElement, status: StatusDef, withLabel = true): HTMLElement {
	const el = parent.createSpan({ cls: ['mtm-status', ...statusClasses(status)] });
	el.createSpan({ cls: 'mtm-status-dot' });
	if (withLabel) el.appendText(status.label);
	return el;
}

/** Makes an element act as a button: click, Enter or Space. */
export function pressable(el: HTMLElement, onPress: (e: MouseEvent | KeyboardEvent) => void): HTMLElement {
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

/** A note at the end of an editor row: how many notes use it, or that setup added it. */
export interface RowNote {
	text: string;
	added?: boolean;
}

export function rowNote(row: HTMLElement, note: RowNote | null): void {
	if (note) row.createSpan({ cls: ['mtm-row-note', ...(note.added ? ['mod-added'] : [])], text: note.text });
}

/** A label made up from an ID shows in italics, with the ID in a tooltip, until the user edits it. */
export function markGenerated(row: HTMLElement, input: HTMLInputElement, id: string, generated: Set<string> | undefined): void {
	if (!generated?.has(id)) return;
	row.addClass('is-generated');
	setTooltip(input, STRINGS.setup.reconnect.fromId(id));
	input.addEventListener(
		'input',
		() => {
			generated.delete(id);
			row.removeClass('is-generated');
		},
		{ once: true },
	);
}
