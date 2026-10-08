// Quick add: the tokens row, suggestions and type picker.

import { setTooltip } from 'obsidian';
import type { StatusDef, TypeDef } from '../../../settings';
import { STRINGS } from '../../../strings';
import { matchRanges } from '../../../services/fuzzy';
import { dateChipLabel, isNewPath, newName, type Draft } from '../../../services/quickAdd';
import type { Chip, NoteCandidate } from '../../../services/quickAddParser';
import { avatarEl, priorityEl } from '../../components/card';
import { appendIcon, statusClasses, tileEl, typeClasses } from '../../components/dom';

export interface MatterCandidate extends NoteCandidate {
	name: string;
	icon: string;
	/** "8 open", "Dormant" or "Closed". */
	meta: string;
}

export interface PersonCandidate extends NoteCandidate {
	name: string;
	folder: string;
	inPeople: boolean;
}

export type Suggestion =
	| { kind: 'matter'; item: MatterCandidate }
	| { kind: 'person'; item: PersonCandidate }
	| { kind: 'new-matter'; name: string }
	| { kind: 'new-person'; name: string };

/** Rows of the suggestion list: suggestions, group labels and separators. */
export type SuggestRow = Suggestion | { kind: 'group'; label: string } | { kind: 'sep' };

export const isSuggestion = (row: SuggestRow): row is Suggestion => row.kind !== 'group' && row.kind !== 'sep';

export interface TokensInput {
	draft: Draft;
	chips: readonly Chip[];
	/** Start of the token being typed: its chip is left out while it is unmatched. */
	typingAt: number | null;
	types: readonly TypeDef[];
	status: StatusDef | undefined;
	matter: MatterCandidate | undefined;
	matterFromContext: boolean;
	peopleFolder: string;
	inboxName: string;
	today: string;
	onRemoveDate: (chip: Chip) => void;
	onRemoveMatter: () => void;
}

function token(parent: HTMLElement, cls: string[], tooltip?: string): HTMLElement {
	const el = parent.createSpan({ cls: ['mtm-token', ...cls] });
	if (tooltip) setTooltip(el, tooltip);
	return el;
}

function removeButton(parent: HTMLElement, label: string, onClick: () => void): void {
	const b = parent.createEl('button', { cls: 'mtm-chip-remove', attr: { 'aria-label': label } });
	appendIcon(b, 'x');
	b.addEventListener('mousedown', (e) => e.preventDefault());
	b.addEventListener('click', onClick);
}

/** Destination first (Matter and status, dashed while they are only defaults), then the typed tokens in order. */
export function renderTokens(row: HTMLElement, t: TokensInput): void {
	const q = STRINGS.quickAdd;
	row.empty();
	const { draft } = t;

	const newMatter = isNewPath(draft.matterPath);
	const matterTip = draft.matterIsDefault
		? q.defaultMatter(t.inboxName)
		: newMatter
			? q.newMatterToken
			: t.matterFromContext
				? q.contextMatter
				: undefined;
	const matter = token(row, ['mod-matter', ...(draft.matterIsDefault ? ['mod-ghost'] : [])], matterTip);
	appendIcon(matter, newMatter ? 'circle-dot' : (t.matter?.icon ?? 'inbox'));
	matter.appendText(newMatter ? newName(draft.matterPath) : (t.matter?.name ?? t.inboxName));
	if (t.matterFromContext) removeButton(matter, q.removeMatter, t.onRemoveMatter);

	if (t.status) {
		const status = token(
			row,
			['mod-status', ...statusClasses(t.status), ...(draft.statusIsDefault ? ['mod-ghost'] : [])],
			draft.statusIsDefault ? q.defaultStatus(t.status.label) : q.contextStatus,
		);
		status.createSpan({ cls: 'mtm-status-dot' });
		status.appendText(t.status.label);
	}

	const shown = t.chips.filter((c) => {
		if (c.kind === 'matter' && c.path) return false; // shown as the destination
		const unmatched = (c.kind === 'type' && !c.id) || ((c.kind === 'matter' || c.kind === 'person') && !c.path);
		return !(unmatched && c.start === t.typingAt);
	});
	if (shown.length) row.createSpan({ cls: 'mtm-qa-tokens-sep' });

	const fallback = t.types.find((x) => x.id === draft.typeId);
	for (const c of shown) {
		if (c.kind === 'type') {
			const type = c.id ? t.types.find((x) => x.id === c.id) : undefined;
			if (type) {
				const el = token(row, typeClasses(type));
				el.createSpan({ cls: 'mtm-token-key', text: '/' });
				appendIcon(el, type.icon);
				el.appendText(type.label);
			} else invalid(row, 'shapes', c.text, q.noType(c.query, fallback?.label ?? ''));
		} else if (c.kind === 'matter') {
			invalid(row, 'folder-x', c.text, q.noMatter(c.query));
		} else if (c.kind === 'person') {
			if (!c.path) {
				invalid(row, 'user-x', c.text, q.noPerson(c.query));
				continue;
			}
			const isNew = isNewPath(c.path);
			const name = isNew ? newName(c.path) : (c.path.split('/').pop()?.replace(/\.md$/i, '') ?? c.path);
			const el = token(row, ['mod-person'], isNew ? q.newPersonToken(t.peopleFolder) : undefined);
			avatarEl(el, name);
			el.appendText(name);
		} else if (c.kind === 'priority') {
			const el = token(row, ['mod-priority', `mod-${c.priority}`]);
			priorityEl(el, c.priority);
			el.appendText(STRINGS.card.priority[c.priority]);
		} else {
			const el = token(row, ['mod-date']);
			appendIcon(el, c.due.includes('T') ? 'clock' : 'calendar');
			el.appendText(dateChipLabel(c.startDate, c.due, t.today));
			removeButton(el, q.removeDate, () => t.onRemoveDate(c));
		}
	}
}

function invalid(row: HTMLElement, icon: string, text: string, tooltip: string): void {
	const el = token(row, ['mod-invalid'], tooltip);
	appendIcon(el, icon);
	el.appendText(text);
}

/** The name with the matched parts in `mark.mtm-match`. */
function highlighted(parent: HTMLElement, name: string, query: string): void {
	const span = parent.createSpan();
	let pos = 0;
	for (const [start, end] of matchRanges(query, name)) {
		if (start > pos) span.appendText(name.slice(pos, start));
		span.createEl('mark', { cls: 'mtm-match', text: name.slice(start, end) });
		pos = end;
	}
	if (pos < name.length) span.appendText(name.slice(pos));
}

export function renderSuggestions(
	list: HTMLElement,
	rows: readonly SuggestRow[],
	selected: number,
	query: string,
	peopleFolder: string,
	onPick: (s: Suggestion) => void,
): void {
	const q = STRINGS.quickAdd;
	list.empty();
	let index = 0;
	for (const row of rows) {
		if (row.kind === 'group') {
			list.createDiv({ cls: 'mtm-suggest-group', text: row.label });
			continue;
		}
		if (row.kind === 'sep') {
			list.createDiv({ cls: 'mtm-suggest-sep' });
			continue;
		}
		const isNew = row.kind === 'new-matter' || row.kind === 'new-person';
		const el = list.createDiv({
			cls: ['mtm-suggest-item', ...(isNew ? ['mtm-suggest-new'] : []), ...(index === selected ? ['is-selected'] : [])],
			attr: { role: 'option', 'aria-selected': String(index === selected) },
		});
		if (row.kind === 'matter') {
			appendIcon(el, row.item.icon);
			highlighted(el, row.item.name, query);
			if (row.item.meta) el.createSpan({ cls: 'mtm-suggest-meta', text: row.item.meta });
		} else if (row.kind === 'person') {
			if (row.item.inPeople) avatarEl(el, row.item.name);
			else appendIcon(el, 'file-text');
			highlighted(el, row.item.name, query);
			if (row.item.folder) el.createSpan({ cls: 'mtm-suggest-meta', text: row.item.folder });
		} else if (row.kind === 'new-matter') {
			appendIcon(el, 'plus');
			el.createSpan({ text: q.newMatter(row.name) });
		} else {
			appendIcon(el, 'user-plus');
			el.createSpan({ text: q.newPerson(row.name) });
			el.createSpan({ cls: 'mtm-suggest-meta', text: peopleFolder });
		}
		// Keep the focus in the input.
		el.addEventListener('mousedown', (e) => e.preventDefault());
		el.addEventListener('click', () => onPick(row));
		index++;
	}
}

export function renderTypePicker(section: HTMLElement, types: readonly TypeDef[], active: string, onPick: (type: TypeDef) => void): void {
	section.empty();
	const picker = section.createDiv({ cls: ['mtm-type-picker', 'mod-row'] });
	for (const type of types) {
		const b = picker.createEl('button', {
			cls: ['mtm-type-option', ...typeClasses(type), ...(type.id === active ? ['is-active'] : [])],
			// The label stays in the text (phones show only the tile), so no aria-label tooltip is needed.
			attr: { 'aria-pressed': String(type.id === active) },
		});
		tileEl(b, type.icon, 'mod-sm');
		b.appendText(type.label);
		b.addEventListener('mousedown', (e) => e.preventDefault());
		b.addEventListener('click', () => onPick(type));
	}
}
