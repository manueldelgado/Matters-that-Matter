// Custom review cadence: "Every <n> <unit>". Used by the New Matter dialog and the Matter overview.

import type { Cadence } from '../../model/matters';
import { STRINGS } from '../../strings';

export interface CadenceFields {
	el: HTMLElement;
	/** The cadence entered, or null while the number is not a whole number of at least 1. */
	value(): Cadence | null;
	focus(): void;
}

/** `onCommit` runs when the number is committed (blur, Enter, spinner) or the unit changes. */
export function cadenceFields(parent: HTMLElement, initial: Cadence, onCommit?: (c: Cadence | null) => void): CadenceFields {
	const t = STRINGS.cadence;
	const el = parent.createDiv({ cls: 'mtm-cadence-custom' });
	el.createSpan({ text: t.every });
	const count = el.createEl('input', {
		type: 'number',
		value: String(initial.n),
		attr: { min: '1', step: '1', inputmode: 'numeric', 'aria-label': t.count },
	});
	const unit = el.createEl('select', { cls: 'dropdown', attr: { 'aria-label': t.unit } });

	const value = (): Cadence | null => {
		const raw = count.value.trim();
		const n = /^\d+$/.test(raw) ? Number(raw) : 0;
		return n >= 1 ? { n, unit: unit.value as Cadence['unit'] } : null;
	};
	const renderUnits = () => {
		const selected = unit.value || initial.unit;
		unit.empty();
		for (const [id, label] of t.units(value()?.n ?? 2)) unit.createEl('option', { value: id, text: label });
		unit.value = selected;
	};
	renderUnits();

	count.addEventListener('input', renderUnits);
	count.addEventListener('change', () => onCommit?.(value()));
	unit.addEventListener('change', () => onCommit?.(value()));
	return { el, value, focus: () => count.focus() };
}
