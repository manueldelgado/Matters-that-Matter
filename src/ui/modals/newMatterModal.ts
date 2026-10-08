// "New Matter": name, icon, Sphere (when there are any) and review cadence.

import { Modal, type App } from 'obsidian';
import type { SphereDef } from '../../settings';
import { formatCadence, parseCadence } from '../../model/matters';
import { STRINGS } from '../../strings';
import { DEFAULT_MATTER_ICON } from '../../vault/index';
import { cadenceFields, type CadenceFields } from '../components/cadenceFields';
import { appendIcon, tileEl } from '../components/dom';
import { IconPickerModal } from './iconPickerModal';

export interface NewMatterResult {
	name: string;
	icon: string;
	reviewEvery: string | null;
	sphereId: string | null;
}

export interface NewMatterContext {
	spheres: readonly SphereDef[];
	/** The Sphere it starts in (from a board focused on one), or none. */
	sphereId: string | null;
}

export class NewMatterModal extends Modal {
	private icon = DEFAULT_MATTER_ICON;
	/** A preset cadence, 'custom', or '' for never. */
	private review = '';
	private custom: CadenceFields | null = null;
	private sphereId: string | null;

	constructor(
		app: App,
		private onCreate: (result: NewMatterResult) => void | Promise<void>,
		private initialName = '',
		private context: NewMatterContext = { spheres: [], sphereId: null },
	) {
		super(app);
		this.sphereId = context.sphereId;
	}

	onOpen(): void {
		const t = STRINGS.newMatter;
		const { contentEl } = this;
		this.modalEl.addClass('mtm-modal');
		contentEl.empty();
		contentEl.createDiv({ cls: 'mtm-modal-head' }).createEl('h2', { cls: 'mtm-modal-title', text: t.title });
		const body = contentEl.createDiv({ cls: 'mtm-modal-body' });

		const nameField = body.createDiv({ cls: 'mtm-field' });
		nameField.createDiv({ cls: 'mtm-label', text: t.name });
		const row = nameField.createDiv({ cls: 'mtm-name-row' });
		const trigger = row.createEl('button', { cls: 'mtm-icon-trigger', attr: { 'aria-label': STRINGS.editors.icon } });
		const renderTrigger = () => {
			trigger.empty();
			tileEl(trigger, this.icon, 'mod-neutral');
			appendIcon(trigger, 'chevron-down');
		};
		renderTrigger();
		trigger.addEventListener('click', () =>
			new IconPickerModal(this.app, this.icon, (icon) => {
				this.icon = icon;
				renderTrigger();
			}).open(),
		);
		const input = row.createEl('input', { type: 'text', value: this.initialName, attr: { 'aria-label': t.name, placeholder: t.placeholder } });

		if (this.context.spheres.length) this.renderSpheres(body);

		const reviewField = body.createDiv({ cls: 'mtm-field' });
		reviewField.createDiv({ cls: 'mtm-label', text: t.review });
		const seg = reviewField.createDiv({ cls: 'mtm-seg mod-full' });
		const c = STRINGS.cadence;
		const options: [string, string][] = [...c.presets, ['custom', c.custom], ['', c.never]];
		for (const [value, label] of options) {
			const item = seg.createEl('button', { cls: 'mtm-seg-item', text: label });
			if (value === this.review) item.addClass('is-active');
			item.addEventListener('click', () => {
				if (value === 'custom') this.showCustom(seg);
				else this.custom?.el.detach();
				this.review = value;
				seg.querySelectorAll('.is-active').forEach((el) => el.removeClass('is-active'));
				item.addClass('is-active');
			});
		}
		reviewField.createSpan({ cls: 'mtm-field-hint', text: t.reviewHint });

		const footer = contentEl.createDiv({ cls: 'mtm-modal-footer' });
		footer.createEl('button', { text: STRINGS.modals.cancel }).addEventListener('click', () => this.close());
		const create = footer.createEl('button', { cls: 'mod-cta', text: t.create });
		const submit = () => {
			const name = input.value.trim();
			if (!name) {
				input.focus();
				return;
			}
			let reviewEvery = this.review || null;
			if (this.review === 'custom') {
				const cadence = this.custom?.value();
				if (!cadence) {
					this.custom?.focus();
					return;
				}
				reviewEvery = formatCadence(cadence);
			}
			create.disabled = true;
			void Promise.resolve(this.onCreate({ name, icon: this.icon, reviewEvery, sphereId: this.sphereId })).finally(() => this.close());
		};
		create.addEventListener('click', submit);
		const onEnter = (e: KeyboardEvent) => {
			if (e.key === 'Enter' && !e.isComposing && (e.target as HTMLElement | null)?.tagName === 'INPUT') submit();
		};
		input.addEventListener('keydown', onEnter);
		reviewField.addEventListener('keydown', onEnter);
		input.focus();
	}

	private renderSpheres(body: HTMLElement): void {
		const field = body.createDiv({ cls: 'mtm-field' });
		field.createDiv({ cls: 'mtm-label', text: STRINGS.newMatter.sphere });
		const seg = field.createDiv({ cls: 'mtm-seg mod-full' });
		const options: [string | null, string, string | null][] = [
			...this.context.spheres.map((s): [string, string, string] => [s.id, s.label, s.icon]),
			[null, STRINGS.newMatter.noSphere, null],
		];
		for (const [id, label, icon] of options) {
			const item = seg.createEl('button', { cls: 'mtm-seg-item' });
			if (icon) appendIcon(item, icon);
			item.appendText(label);
			if (id === this.sphereId) item.addClass('is-active');
			item.addEventListener('click', () => {
				this.sphereId = id;
				seg.querySelectorAll('.is-active').forEach((el) => el.removeClass('is-active'));
				item.addClass('is-active');
			});
		}
	}

	/** Shows the custom fields under the segments, starting from the preset that was selected. */
	private showCustom(seg: HTMLElement): void {
		this.custom ??= cadenceFields(seg.parentElement ?? this.contentEl, parseCadence(this.review) ?? { n: 1, unit: 'w' });
		seg.after(this.custom.el);
		this.custom.focus();
	}

	onClose(): void {
		this.custom = null;
		this.contentEl.empty();
	}
}
