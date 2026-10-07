// Small DOM helpers shared by views and modals.

import { setIcon } from 'obsidian';
import type { StatusDef, TypeDef } from '../../settings';
import { classId } from '../../services/ids';

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
