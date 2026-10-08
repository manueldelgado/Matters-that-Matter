// Sphere editor, used by the settings tab: like the type editor, without tones or a default, with how many Matters use each.

import type { App } from 'obsidian';
import type { SphereDef } from '../../settings';
import { STRINGS } from '../../strings';
import { idFromLabel } from '../../services/ids';
import { moveItem } from '../../model/workflow';
import { IconPickerModal } from '../modals/iconPickerModal';
import { appendIcon, tileEl } from './dom';
import { reorderable } from './reorder';

export interface SphereEditorOptions {
	spheres: SphereDef[];
	/** How many Matters are in a Sphere. */
	count(id: string): number;
	onChange(spheres: SphereDef[]): void;
	onDelete(sphere: SphereDef): void;
}

export class SphereEditor {
	private spheres: SphereDef[];
	/** Spheres added in this session: their ID follows the name until it is first saved with one. */
	private fresh = new Set<string>();
	private listEl: HTMLElement;

	constructor(private app: App, parent: HTMLElement, private opts: SphereEditorOptions) {
		this.spheres = opts.spheres;
		this.listEl = parent.createDiv({ cls: 'mtm-editor-list' });
		this.render();
	}

	set(spheres: SphereDef[]): void {
		this.spheres = spheres;
		this.render();
	}

	private commit(spheres: SphereDef[]): void {
		this.spheres = spheres;
		this.opts.onChange(spheres);
		this.render();
	}

	private render(): void {
		this.listEl.empty();
		this.spheres.forEach((sphere, i) => this.renderRow(sphere, i));
		const add = this.listEl.createDiv({ cls: 'mtm-row-add', attr: { role: 'button', tabindex: 0 } });
		appendIcon(add, 'plus');
		add.appendText(STRINGS.editors.addSphere);
		add.addEventListener('click', () => {
			const label = STRINGS.editors.newSphere;
			const id = idFromLabel(label, this.spheres.map((s) => s.id));
			this.fresh.add(id);
			this.commit([...this.spheres, { id, label, icon: 'circle-dot' }]);
			this.listEl.querySelectorAll<HTMLInputElement>('.mtm-sphere-row input[type="text"]').item(this.spheres.length - 1)?.select();
		});
	}

	private renderRow(sphere: SphereDef, index: number): void {
		let current = sphere;
		const row = this.listEl.createDiv({ cls: 'mtm-sphere-row' });
		reorderable(row, index, this.spheres.length, (from, to) => this.commit(moveItem(this.spheres, from, to)));

		const trigger = row.createEl('button', { cls: 'mtm-icon-trigger', attr: { 'aria-label': STRINGS.editors.icon } });
		tileEl(trigger, sphere.icon, 'mod-neutral');
		appendIcon(trigger, 'chevron-down');
		trigger.addEventListener('click', () => {
			new IconPickerModal(this.app, current.icon, (icon) => this.commit(this.spheres.map((s) => (s.id === current.id ? { ...s, icon } : s)))).open();
		});

		const input = row.createEl('input', { type: 'text', value: sphere.label, attr: { 'aria-label': STRINGS.editors.name } });
		input.addEventListener('input', () => {
			const label = input.value;
			let id = current.id;
			// A new Sphere's ID follows its first name; after that, IDs never change.
			if (this.fresh.has(id) && label.trim()) {
				this.fresh.delete(id);
				id = idFromLabel(label, this.spheres.filter((s) => s !== current).map((s) => s.id));
				this.fresh.add(id);
			}
			const updated = { ...current, id, label };
			this.spheres = this.spheres.map((s) => (s === current ? updated : s));
			current = updated;
			this.opts.onChange(this.spheres);
		});
		input.addEventListener('blur', () => {
			if (input.value.trim()) return;
			input.value = STRINGS.editors.newSphere;
			input.dispatchEvent(new Event('input'));
		});

		row.createSpan({ cls: 'mtm-row-note', text: STRINGS.editors.sphereMatters(this.opts.count(sphere.id)) });

		const del = row.createDiv({ cls: 'clickable-icon', attr: { 'aria-label': STRINGS.editors.deleteSphere } });
		appendIcon(del, 'trash-2');
		del.addEventListener('click', () => this.opts.onDelete(current));
	}
}
