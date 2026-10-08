// Action type editor, used by the settings tab.

import { Notice, type App } from 'obsidian';
import type { TypeDef } from '../../settings';
import { STRINGS } from '../../strings';
import { idFromLabel } from '../../services/ids';
import { addType, canDeleteType, moveItem, setDefaultType } from '../../model/workflow';
import { IconPickerModal } from '../modals/iconPickerModal';
import { appendIcon, swapClasses, tileEl, typeClasses } from './dom';
import { reorderable } from './reorder';
import { swatches } from './tonePopover';

export interface TypeEditorOptions {
	types: TypeDef[];
	onChange(types: TypeDef[]): void;
	onDelete(type: TypeDef): void;
}

export class TypeEditor {
	private types: TypeDef[];
	private fresh = new Set<string>();
	private listEl: HTMLElement;

	constructor(private app: App, parent: HTMLElement, private opts: TypeEditorOptions) {
		this.types = opts.types;
		this.listEl = parent.createDiv({ cls: 'mtm-editor-list' });
		this.render();
	}

	set(types: TypeDef[]): void {
		this.types = types;
		this.render();
	}

	private commit(types: TypeDef[]): void {
		this.types = types;
		this.opts.onChange(types);
		this.render();
	}

	private update(id: string, patch: Partial<TypeDef>): void {
		this.commit(this.types.map((t) => (t.id === id ? { ...t, ...patch } : t)));
	}

	private render(): void {
		this.listEl.empty();
		this.types.forEach((type, i) => this.renderRow(type, i));
		const add = this.listEl.createDiv({ cls: 'mtm-row-add' });
		appendIcon(add, 'plus');
		add.appendText(STRINGS.editors.addType);
		add.addEventListener('click', () => {
			const next = addType(this.types, STRINGS.editors.newType, 'circle-dot', 'ink');
			const created = next[next.length - 1];
			if (created) this.fresh.add(created.id);
			this.commit(next);
			this.listEl.querySelectorAll<HTMLInputElement>('.mtm-type-row input[type="text"]').item(next.length - 1)?.select();
		});
	}

	private renderRow(type: TypeDef, index: number): void {
		let current = type;
		const row = this.listEl.createDiv({ cls: ['mtm-type-row', ...typeClasses(type)] });
		reorderable(row, index, this.types.length, (from, to) => this.commit(moveItem(this.types, from, to)));

		const trigger = row.createEl('button', { cls: 'mtm-icon-trigger', attr: { 'aria-label': STRINGS.editors.icon } });
		tileEl(trigger, type.icon);
		appendIcon(trigger, 'chevron-down');
		trigger.addEventListener('click', () => {
			new IconPickerModal(this.app, current.icon, (icon) => this.update(current.id, { icon }), typeClasses(current)).open();
		});

		const input = row.createEl('input', { type: 'text', value: type.label, attr: { 'aria-label': STRINGS.editors.name } });
		input.addEventListener('input', () => {
			const label = input.value;
			let id = current.id;
			if (this.fresh.has(id) && label.trim()) {
				this.fresh.delete(id);
				id = idFromLabel(label, this.types.filter((t) => t !== current).map((t) => t.id));
				this.fresh.add(id);
			}
			const updated = { ...current, id, label };
			this.types = this.types.map((t) => (t === current ? updated : t));
			current = updated;
			swapClasses(row, ['mtm-type-', 'mtm-tone-'], typeClasses(updated), ['mtm-type-row']);
			this.opts.onChange(this.types);
		});
		input.addEventListener('blur', () => {
			if (input.value.trim()) return;
			input.value = STRINGS.editors.newType;
			input.dispatchEvent(new Event('input'));
		});

		swatches(row, type.tone, (tone) => this.update(current.id, { tone }));

		// Same element in both states, like the status editor's markers, so the row never shifts.
		const marker = row.createEl('button', { cls: 'mtm-marker', text: STRINGS.editors.default });
		if (type.default) marker.addClass('is-active');
		else marker.setAttr('aria-label', STRINGS.editors.makeDefault);
		marker.addEventListener('click', () => {
			if (current.default) return;
			const next = setDefaultType(this.types, current.id);
			if (next) this.commit(next);
		});

		const del = row.createDiv({ cls: 'clickable-icon', attr: { 'aria-label': STRINGS.editors.deleteType } });
		appendIcon(del, 'trash-2');
		del.addEventListener('click', () => {
			if (!canDeleteType(current)) new Notice(STRINGS.notices.cannotDeleteFlagged);
			else this.opts.onDelete(current);
		});
	}
}
