// Status editor, shared by the setup wizard and the settings tab.

import { Notice, setTooltip } from 'obsidian';
import type { StatusCategory, StatusDef } from '../../settings';
import { STRINGS } from '../../strings';
import { idFromLabel } from '../../services/ids';
import { addStatus, canDeleteStatus, moveItem, setBacklog, setCategory, setDone } from '../../model/workflow';
import { appendIcon, statusClasses, swapClasses } from './dom';
import { reorderable } from './reorder';
import { openTonePopover } from './tonePopover';

export interface StatusEditorOptions {
	statuses: StatusDef[];
	/** Called after every edit with the new list. */
	onChange(statuses: StatusDef[]): void;
	/** Called when the user deletes a status that may be deleted. */
	onDelete(status: StatusDef): void;
}

const CATEGORIES: StatusCategory[] = ['open', 'active', 'closed'];

export class StatusEditor {
	private statuses: StatusDef[];
	/** IDs created in this session: they follow the label until the editor closes. */
	private fresh = new Set<string>();
	private listEl: HTMLElement;

	constructor(parent: HTMLElement, private opts: StatusEditorOptions) {
		this.statuses = opts.statuses;
		this.listEl = parent.createDiv({ cls: 'mtm-editor-list' });
		this.render();
	}

	set(statuses: StatusDef[]): void {
		this.statuses = statuses;
		this.render();
	}

	private commit(statuses: StatusDef[], rerender = true): void {
		this.statuses = statuses;
		this.opts.onChange(statuses);
		if (rerender) this.render();
	}

	private render(): void {
		this.listEl.empty();
		this.statuses.forEach((status, i) => this.renderRow(status, i));
		const add = this.listEl.createDiv({ cls: 'mtm-row-add' });
		appendIcon(add, 'plus');
		add.appendText(STRINGS.editors.addStatus);
		add.addEventListener('click', () => {
			const next = addStatus(this.statuses, STRINGS.editors.newStatus, 'ink', 'open');
			const created = next[next.length - 1];
			if (created) this.fresh.add(created.id);
			this.commit(next);
			this.listEl.querySelectorAll<HTMLInputElement>('.mtm-status-row input[type="text"]').item(next.length - 1)?.select();
		});
	}

	private renderRow(status: StatusDef, index: number): void {
		let current = status;
		const row = this.listEl.createDiv({ cls: ['mtm-status-row', ...statusClasses(status)] });
		reorderable(row, index, this.statuses.length, (from, to) => this.commit(moveItem(this.statuses, from, to)), 'statuses');

		const tone = row.createEl('button', { cls: 'mtm-tone-trigger', attr: { 'aria-label': STRINGS.editors.colour } });
		tone.createSpan({ cls: 'mtm-status-dot' });
		appendIcon(tone, 'chevron-down');
		tone.addEventListener('click', () =>
			openTonePopover(tone, current.tone, (t) => this.commit(this.statuses.map((s) => (s.id === current.id ? { ...s, tone: t } : s)))),
		);

		const input = row.createEl('input', { type: 'text', value: status.label, attr: { 'aria-label': STRINGS.editors.label } });
		input.addEventListener('input', () => {
			const label = input.value;
			let id = current.id;
			if (this.fresh.has(id) && label.trim()) {
				this.fresh.delete(id);
				id = idFromLabel(label, this.statuses.filter((s) => s !== current).map((s) => s.id));
				this.fresh.add(id);
			}
			const updated = { ...current, id, label };
			this.statuses = this.statuses.map((s) => (s === current ? updated : s));
			current = updated;
			swapClasses(row, ['mtm-status-'], statusClasses(updated), ['mtm-status-row']);
			this.opts.onChange(this.statuses);
		});
		input.addEventListener('blur', () => {
			if (input.value.trim()) return;
			input.value = STRINGS.editors.newStatus;
			input.dispatchEvent(new Event('input'));
		});

		const select = row.createEl('select', { cls: 'dropdown', attr: { 'aria-label': STRINGS.editors.category } });
		for (const c of CATEGORIES) select.createEl('option', { value: c, text: STRINGS.categories[c] });
		select.value = status.category;
		select.addEventListener('change', () => {
			const next = setCategory(this.statuses, current.id, select.value as StatusCategory);
			if (!next) {
				new Notice(current.backlog ? STRINGS.notices.cannotBacklogClosed : STRINGS.notices.cannotDoneOpen);
				select.value = current.category;
				return;
			}
			this.commit(next);
		});

		const markers = row.createDiv({ cls: 'mtm-row-markers' });
		const backlog = markers.createEl('button', { cls: 'mtm-marker' });
		appendIcon(backlog, 'inbox');
		backlog.appendText(STRINGS.editors.backlog);
		setTooltip(backlog, STRINGS.editors.backlogHint);
		if (status.backlog) backlog.addClasses(['is-active', 'mtm-tone-sky']);
		backlog.addEventListener('click', () => {
			if (current.backlog) return;
			const next = setBacklog(this.statuses, current.id);
			if (next) this.commit(next);
			else new Notice(STRINGS.notices.backlogNeedsOpen);
		});

		const done = markers.createEl('button', { cls: 'mtm-marker' });
		appendIcon(done, 'check');
		done.appendText(STRINGS.editors.done);
		setTooltip(done, STRINGS.editors.doneHint);
		if (status.done) done.addClasses(['is-active', 'mtm-tone-mint']);
		done.addEventListener('click', () => {
			if (current.done) return;
			const next = setDone(this.statuses, current.id);
			if (next) this.commit(next);
			else new Notice(STRINGS.notices.doneNeedsClosed);
		});

		const del = row.createDiv({ cls: 'clickable-icon', attr: { 'aria-label': STRINGS.editors.deleteStatus } });
		appendIcon(del, 'trash-2');
		del.addEventListener('click', () => {
			if (!canDeleteStatus(current)) new Notice(STRINGS.notices.cannotDeleteFlagged);
			else this.opts.onDelete(current);
		});
	}
}
