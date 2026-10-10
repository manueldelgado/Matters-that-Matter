// A Matter's editable parts, shared by the Matter overview and the review session: the outcome (edited in place),
// the state control and the review rhythm.

import { parseCadence, type Cadence, type MatterState } from '../../model/matters';
import { STRINGS } from '../../strings';
import { cadenceFields } from './cadenceFields';
import { appendIcon, pressable } from './dom';

export const STATE_ICONS: Record<MatterState, string> = { active: 'circle-play', dormant: 'moon', closed: 'archive' };

/** The outcome, edited in place (Enter or blur saves, Esc cancels); a dashed invitation when unset. */
export function renderOutcomeField(parent: HTMLElement, outcome: string | null, onSave: (text: string) => void): HTMLElement {
	const o = STRINGS.overview;
	const box = parent.createDiv({ cls: ['mtm-outcome', ...(outcome ? [] : ['mod-empty'])] });
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
			// Esc cancels the edit, not the dialog around it.
			e.stopPropagation();
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
		onSave(value);
	});
	if (outcome) {
		const edit = box.createDiv({ cls: 'clickable-icon', attr: { 'aria-label': o.editOutcome } });
		appendIcon(edit, 'pencil');
		pressable(edit, () => text.focus());
	}
	return box;
}

/** Active, Dormant, Closed. */
export function renderStateSeg(parent: HTMLElement, state: MatterState, onPick: (state: MatterState) => void): HTMLElement {
	const o = STRINGS.overview;
	const seg = parent.createDiv({ cls: 'mtm-seg', attr: { role: 'radiogroup' } });
	for (const s of ['active', 'dormant', 'closed'] as const) {
		const active = state === s;
		const b = seg.createEl('button', {
			cls: ['mtm-seg-item', ...(active ? ['is-active'] : [])],
			attr: { role: 'radio', 'aria-checked': String(active) },
		});
		appendIcon(b, STATE_ICONS[s]);
		b.appendText(o.states[s]);
		b.addEventListener('click', () => {
			if (!active) onPick(s);
		});
	}
	return seg;
}

export interface CadenceHandlers {
	setCadence: (cadence: Cadence | null) => void;
	/** Custom chosen in the dropdown, not committed yet: the caller re-renders with `custom`. */
	chooseCustom: () => void;
}

/**
 * The review rhythm: Never, the presets, Custom with "Every <n> <unit>". `label` goes before the dropdown
 * (the overview's "Review"); `custom` shows the custom fields before a custom value is committed.
 */
export function renderCadenceControl(parent: HTMLElement, rawCadence: unknown, custom: boolean, h: CadenceHandlers, label?: string): void {
	const o = STRINGS.overview;
	const c = STRINGS.cadence;
	const raw = typeof rawCadence === 'string' ? rawCadence.trim() : '';
	const cadence = parseCadence(rawCadence);
	const preset = cadence ? c.presets.find(([key]) => key === `${cadence.n}${cadence.unit}`)?.[0] : undefined;
	const value = custom || (cadence && !preset) ? 'custom' : (preset ?? 'never');

	const wrap = parent.createSpan({ cls: 'mtm-overview-cadence' });
	if (label) wrap.appendText(label);
	const select = wrap.createEl('select', { cls: 'dropdown', attr: { 'aria-label': label ?? o.review } });
	select.createEl('option', { value: 'never', text: c.never });
	for (const [key, text] of c.presets) select.createEl('option', { value: key, text });
	select.createEl('option', { value: 'custom', text: c.custom });
	select.value = value;
	select.addEventListener('change', () => {
		if (select.value === 'custom') h.chooseCustom();
		else h.setCadence(select.value === 'never' ? null : parseCadence(select.value));
	});

	if (value === 'custom') {
		const fields = cadenceFields(parent, cadence ?? { n: 1, unit: 'w' }, (next) => {
			if (next) h.setCadence(next);
		});
		if (custom && !cadence) fields.focus();
	}
	if (raw && !cadence) parent.createSpan({ cls: 'mtm-field-hint', text: o.invalidCadence(raw) });
}
